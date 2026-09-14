/**
 * Convert an Atlassian Document Format (ADF) node tree to markdown-ish text.
 *
 * Dependency-free and DETERMINISTIC — the same ADF must always yield
 * byte-identical markdown, because the consolidator content-addresses each block
 * by `sha256(docPath + headingPath + text)`. Any nondeterminism (a locale-rendered
 * date/mention, mark output that followed array order, a converter that flattened
 * headings) would change block ids → cache misses → LLM cost on every sync, even
 * for unchanged issues. So: **headings are preserved** (demoted one level — the
 * issue title owns the doc's H1), lists/tables/paragraphs become readable text,
 * ADF wrappers (panels, expands, media) collapse to their inner text, and inline
 * atoms are rendered from their `attrs` — never from a per-user rendered body.
 *
 * Unrecognized node types recurse into their content and emit their text leaves
 * rather than throwing: ADF grows new node types over time, and a new one must
 * never fail a sync. Malformed input (null, a non-object, a doc with no content)
 * yields an empty string.
 */

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeOf(node: unknown): string {
  return isObject(node) && typeof node.type === 'string' ? node.type : '';
}

function childNodes(node: unknown): unknown[] {
  return isObject(node) && Array.isArray(node.content) ? node.content : [];
}

function attrsOf(node: unknown): Json {
  return isObject(node) && isObject(node.attrs) ? node.attrs : {};
}

function marksOf(node: unknown): unknown[] {
  return isObject(node) && Array.isArray(node.marks) ? node.marks : [];
}

function textOf(node: unknown): string {
  return isObject(node) && typeof node.text === 'string' ? node.text : '';
}

/** Format an epoch-ms timestamp as `YYYY-MM-DD` in UTC (locale-independent). */
function formatUtcDate(ts: unknown): string {
  const ms = typeof ts === 'string' ? Number(ts) : typeof ts === 'number' ? ts : NaN;
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Wrap text in the markup for its supported marks. Applied in a fixed order
 * (regardless of the marks-array order) for determinism; strong/em/code/link
 * render, every other mark (underline, strike, textColor, …) leaves text plain.
 */
function applyMarks(text: string, marks: unknown[]): string {
  const kinds = new Set<string>();
  let href = '';
  for (const m of marks) {
    const k = typeOf(m);
    if (!k) continue;
    kinds.add(k);
    if (k === 'link') {
      const h = attrsOf(m).href;
      if (typeof h === 'string') href = h;
    }
  }
  let s = text;
  if (kinds.has('code')) s = '`' + s + '`';
  if (kinds.has('link') && href) s = `[${s}](${href})`;
  if (kinds.has('em')) s = `_${s}_`;
  if (kinds.has('strong')) s = `**${s}**`;
  return s;
}

/** Render one inline node (text leaf or atom). Unknown → recurse into content. */
function inline(node: unknown): string {
  switch (typeOf(node)) {
    case 'text':
      return applyMarks(textOf(node), marksOf(node));
    case 'hardBreak':
      return '\n';
    case 'mention': {
      // `attrs.text` is already `@Name`; strip a leading `@` then prepend one so
      // it never double-@'s (and stays a plain token — no user-lookup render).
      const raw = attrsOf(node).text;
      const name = (typeof raw === 'string' ? raw : '').replace(/^@+/, '');
      return name ? `@${name}` : '';
    }
    case 'emoji': {
      const a = attrsOf(node);
      if (typeof a.shortName === 'string') return a.shortName;
      return typeof a.text === 'string' ? a.text : '';
    }
    case 'status': {
      const t = attrsOf(node).text;
      return typeof t === 'string' ? t : '';
    }
    case 'inlineCard': {
      const a = attrsOf(node);
      if (typeof a.url === 'string') return a.url;
      if (isObject(a.data) && typeof a.data.url === 'string') return a.data.url;
      return '';
    }
    case 'date':
      return formatUtcDate(attrsOf(node).timestamp);
    default:
      return inlineAll(childNodes(node));
  }
}

function inlineAll(nodes: unknown[]): string {
  let out = '';
  for (const n of nodes) out += inline(n);
  return out;
}

/** Concatenate the raw text of a subtree (code blocks keep their literal body). */
function plainText(nodes: unknown[]): string {
  let out = '';
  for (const n of nodes) {
    const t = typeOf(n);
    if (t === 'text') out += textOf(n);
    else if (t === 'hardBreak') out += '\n';
    else out += plainText(childNodes(n));
  }
  return out;
}

/** Append `- ` lines for a list node's items (nested lists flatten to siblings). */
function listLines(listNode: unknown, lines: string[]): void {
  for (const item of childNodes(listNode)) {
    switch (typeOf(item)) {
      case 'taskItem': {
        const box = attrsOf(item).state === 'DONE' ? '[x]' : '[ ]';
        const text = inlineAll(childNodes(item)).trim();
        lines.push(text ? `- ${box} ${text}` : `- ${box}`);
        break;
      }
      case 'decisionItem': {
        const text = inlineAll(childNodes(item)).trim();
        if (text) lines.push(`- ${text}`);
        break;
      }
      default:
        listItemLines(item, lines);
    }
  }
}

/** A listItem's block children become items; nested lists flatten in place. */
function listItemLines(item: unknown, lines: string[]): void {
  for (const child of childNodes(item)) {
    switch (typeOf(child)) {
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
      case 'decisionList':
        listLines(child, lines);
        break;
      default: {
        const rendered = block(child);
        for (const ln of rendered.split('\n')) {
          if (ln.trim() !== '') lines.push(`- ${ln}`);
        }
      }
    }
  }
}

/** One line per row; cells joined with ` | ` (no header separator). */
function renderTable(node: unknown): string {
  const rows: string[] = [];
  for (const row of childNodes(node)) {
    if (typeOf(row) !== 'tableRow') continue;
    const cells: string[] = [];
    for (const cell of childNodes(row)) {
      const text = blocksOf(childNodes(cell)).replace(/\s*\n\s*/g, ' ').trim();
      cells.push(text);
    }
    rows.push(cells.join(' | '));
  }
  return rows.join('\n');
}

/** Render one block node to its markdown string (may span multiple lines). */
function block(node: unknown): string {
  switch (typeOf(node)) {
    case 'heading': {
      // Demote one level: the issue title owns the doc's H1, so an in-description
      // H1 becomes H2; H6 has nowhere to go and stays H6.
      const lvl = attrsOf(node).level;
      const n = typeof lvl === 'number' && lvl >= 1 && lvl <= 6 ? lvl : 1;
      return '#'.repeat(Math.min(n + 1, 6)) + ' ' + inlineAll(childNodes(node));
    }
    case 'paragraph':
      return inlineAll(childNodes(node));
    case 'rule':
      return '---';
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
    case 'decisionList': {
      const lines: string[] = [];
      listLines(node, lines);
      return lines.join('\n');
    }
    case 'codeBlock': {
      const lang = attrsOf(node).language;
      const fence = typeof lang === 'string' ? lang : '';
      return '```' + fence + '\n' + plainText(childNodes(node)) + '\n```';
    }
    case 'blockquote':
      return blocksOf(childNodes(node))
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'panel':
    case 'expand':
    case 'nestedExpand': {
      // Drop the wrapper, keep the inner content; an expand's title is a bold line.
      const parts: string[] = [];
      const title = attrsOf(node).title;
      if (typeof title === 'string' && title.trim()) parts.push(`**${title.trim()}**`);
      const inner = blocksOf(childNodes(node));
      if (inner) parts.push(inner);
      return parts.join('\n\n');
    }
    case 'table':
      return renderTable(node);
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
    case 'mediaInline':
      return '';
    case 'text':
    case 'hardBreak':
    case 'mention':
    case 'emoji':
    case 'status':
    case 'inlineCard':
    case 'date':
      return inline(node);
    default:
      // Unknown block — recurse into content so a future ADF node never fails a sync.
      return blocksOf(childNodes(node));
  }
}

/** Render a list of block nodes, dropping empties, blocks separated by blank lines. */
function blocksOf(nodes: unknown[]): string {
  const parts: string[] = [];
  for (const n of nodes) {
    const s = block(n);
    if (s.trim() !== '') parts.push(s);
  }
  return parts.join('\n\n');
}

export function adfToMarkdown(doc: unknown): string {
  if (!isObject(doc)) return '';
  return normalize(blocksOf(childNodes(doc)));
}

/** Whitespace normalization identical to the Confluence converter. */
function normalize(s: string): string {
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
