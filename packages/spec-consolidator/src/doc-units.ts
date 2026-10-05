/**
 * A doc's UNITS: the smallest numbered pieces of a document the scan points
 * at. A session that records what a doc states is handed its units, numbered,
 * and has to account for every one of them: cite it in a fact or skip it with
 * a reason. A unit's `text` is an exact slice of the body (`body.slice(start,
 * end)`), so a quote cut from it is verbatim by construction.
 *
 * Deterministic. Numbering is 1-based in document order, so an edit renumbers
 * only the units at and after it. The heading a unit sits under is the text
 * `parseHeadings` gives for the nearest ATX heading above it (what a doc's
 * outline lists and a section pointer names), `null` above the first heading.
 *
 * What is a unit:
 *
 * - FRONTMATTER: the top-level `title` and `description` values, one unit
 *   each, without their quotes. Every other line of the frontmatter is cut the
 *   way a fenced block is: each run of them between those two values (a token
 *   tree, `version`, `slug`) is cut into parts of {@link CODE_UNIT_LINES}
 *   lines, each part a unit, so what a design system declares in its
 *   frontmatter can be cited too.
 * - SENTENCE: a paragraph is cut at sentence ends: `.`, `!`, `?` or `…`
 *   (closing quotes, brackets, emphasis markers and closing tags may follow),
 *   then whitespace, then anything but a lowercase letter or `,;:)`. The lines
 *   of a hard-wrapped paragraph join; a hard line break (two trailing spaces,
 *   a trailing backslash, a trailing `<br>`) ends a sentence. Punctuation
 *   inside an inline code span, an inline link or image, a tag, a comment or
 *   a `{…}` expression never ends one: a code span ending in a period is a
 *   literal (`.env`, `v5.1.0`), so the sentence runs on. Merging two sentences
 *   is the safe error, since a unit may state two facts. A period after a
 *   common abbreviation (`e.g.`, `i.e.`, `vs.`, `cf.`, `approx.`, `Dr.`, …) or
 *   after a single capital initial does not end a sentence. A sentence with no
 *   letter or digit (a `·` between two links) is not a unit.
 * - Blockquotes and callouts are prose: a `>` quote's paragraphs and the text
 *   of a component (`<Info>…</Info>`, `<Tip>`, `<Note>`, a `<Card>` body) are
 *   cut into sentences like any other paragraph. A GitHub alert marker line
 *   (`> [!NOTE]`) is not a unit.
 * - ITEM: one list item: its first paragraph, lazy continuation lines
 *   included. A nested item is a unit of its own, and a later paragraph inside
 *   an item is cut into sentences. Deeper indentation than the parent's marker
 *   nests, as authors mean it, even where CommonMark would not. An ordered
 *   marker other than `1.` does not interrupt a paragraph.
 * - ROW: one table row, from its first to its last non-space character. The
 *   header row and the separator row are not units, nor is a row of empty
 *   cells. A table continues while its lines carry a `|`.
 * - CODE: the content lines of one fenced block (a fence at any indentation,
 *   so a block inside a component counts), cut into parts of
 *   {@link CODE_UNIT_LINES} lines; each part is a unit. A block with no content
 *   is none. Indented code blocks are not recognized: MDX has none, and
 *   indented lines inside a component are prose.
 * - TAG: the quoted `title`, `caption`, `label` or `description` attribute of
 *   a tag that opens its line (`<Step title="Create an Account">`), the value
 *   without its quotes.
 *
 * Not units: headings (ATX, and an HTML `<h1>`…`<h6>` line), blank lines,
 * thematic breaks and setext underlines (the text above an underline stays a
 * sentence: the outline lists no setext heading), lines of tags only, `{…}` expression
 * lines, HTML comments and `{/* … *\/}` comments (whatever shares a line with
 * one), and an MDX `import`/`export` block (from such a line at column 0 to the
 * next blank line). A tag opening or closing a line of prose is cut off it
 * only when it is a block tag (a component like `<Tip>`, or an HTML block
 * element like `<p>`); an inline tag (`<a>`, `<strong>`) stays in its sentence.
 */

import { parseHeadings } from '@truecourse/shared';

/** Bumped by hand whenever a change here moves a unit's number or text. */
export const UNIT_SPLITTER_VERSION = 1;

/**
 * Lines of a fenced block's content (or of a run of frontmatter) one unit
 * holds at most. Small enough that a fact cites the lines that state it and a
 * conflict's quote comes from them, rather than a part so long it can only be
 * summarized.
 */
export const CODE_UNIT_LINES = 12;

interface UnitBase {
  /** 1-based, in document order. */
  n: number;
  /** The heading the unit sits under, as the outline lists it; `null` above the first heading. */
  heading: string | null;
  /** 1-based line range, inclusive. */
  startLine: number;
  endLine: number;
  /** Character offsets in the body: `text === body.slice(start, end)`. */
  start: number;
  end: number;
  text: string;
}

/** What distinguishes each kind of unit, beside the fields every unit has. */
type UnitShape =
  | { kind: 'frontmatter'; field: 'title' | 'description' }
  /** A run of the frontmatter's other lines, or one part of a long run. */
  | { kind: 'frontmatter'; field: null; part: number; parts: number }
  | { kind: 'sentence' }
  | {
      kind: 'item';
      /** 0 for a top-level item. */
      depth: number;
      /** The unit introducing the list (for a nested item, its parent item), or `null`. */
      intro: number | null;
    }
  | { kind: 'row'; columns: readonly string[] }
  | { kind: 'code'; lang: string | null; part: number; parts: number }
  | { kind: 'tag'; tag: string; attribute: string };

export type DocUnit = UnitBase & UnitShape;
export type DocUnitKind = DocUnit['kind'];

/** A unit before it is numbered and placed. */
type UnitDraft = UnitShape & { start: number; end: number };

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

interface Line {
  start: number;
  /** Past the last character, a trailing `\r` excluded. */
  end: number;
}

function lineSpans(body: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (;;) {
    const nl = body.indexOf('\n', start);
    const stop = nl === -1 ? body.length : nl;
    lines.push({ start, end: stop > start && body[stop - 1] === '\r' ? stop - 1 : stop });
    if (nl === -1) return lines;
    start = nl + 1;
  }
}

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t';
const hasWord = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

/** The first offset in `[at, end)` that is not a space or tab, else `end`. */
function skipSpaces(body: string, at: number, end: number): number {
  while (at < end && isSpace(body[at])) at++;
  return at;
}

/** `at` moved back over trailing whitespace, no further than `start`. */
function trimEnd(body: string, start: number, at: number): number {
  while (at > start && /\s/.test(body[at - 1]!)) at--;
  return at;
}

/** The visual column of `at` counted from `from`, a tab advancing to the next multiple of 4. */
function columnOf(body: string, from: number, at: number): number {
  let col = 0;
  for (let i = from; i < at; i++) col = body[i] === '\t' ? col + 4 - (col % 4) : col + 1;
  return col;
}

/** A line's blockquote depth, and where its content starts after the `>` markers. */
function quotePrefix(body: string, line: Line): { depth: number; contentStart: number } {
  let at = line.start;
  let depth = 0;
  for (;;) {
    let probe = at;
    while (probe - at < 3 && body[probe] === ' ') probe++;
    if (probe >= line.end || body[probe] !== '>') return { depth, contentStart: at };
    depth++;
    at = probe + 1;
    if (isSpace(body[at])) at++;
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

interface TagSpan {
  /** As written for a component, lowercased for an HTML element; `!--` for a comment, `''` for a fragment. */
  name: string;
  closing: boolean;
  end: number;
  attributes: Array<{ name: string; valueStart: number; valueEnd: number }>;
}

/** The longest stretch one tag may span before its `<` is taken for a stray one. */
const TAG_SCAN_CHARS = 4_000;

/** Past a balanced `{…}` starting at `at`, quoted strings respected; -1 when it does not close before `limit`. */
function skipBraces(text: string, at: number, limit: number): number {
  let depth = 0;
  for (let i = at; i < limit; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const close = text.indexOf(c, i + 1);
      if (close === -1 || close >= limit) return -1;
      i = close;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

const tagName = (raw: string): string => (/^[A-Z]/.test(raw) ? raw : raw.toLowerCase());

/** The tag (or HTML comment) opening at `at`, or `null` when the `<` there opens none. */
function lexTag(text: string, at: number): TagSpan | null {
  if (text[at] !== '<') return null;
  const limit = Math.min(text.length, at + TAG_SCAN_CHARS);
  if (text.startsWith('<!--', at)) {
    const close = text.indexOf('-->', at + 4);
    return { name: '!--', closing: false, end: close === -1 ? text.length : close + 3, attributes: [] };
  }
  let i = at + 1;
  const closing = text[i] === '/';
  if (closing) i++;
  if (text[i] === '>') return { name: '', closing, end: i + 1, attributes: [] };
  const raw = /^[A-Za-z][\w.:-]*/.exec(text.slice(i, Math.min(limit, i + 80)))?.[0];
  if (!raw) return null;
  const name = tagName(raw);
  i += raw.length;
  const attributes: TagSpan['attributes'] = [];
  while (i < limit) {
    while (i < limit && /\s/.test(text[i]!)) i++;
    if (text[i] === '>') return { name, closing, end: i + 1, attributes };
    if (text[i] === '/' && text[i + 1] === '>') return { name, closing, end: i + 2, attributes };
    if (text[i] === '{') {
      const after = skipBraces(text, i, limit);
      if (after === -1) return null;
      i = after;
      continue;
    }
    const attribute = /^[^\s=/>"'{}]+/.exec(text.slice(i, Math.min(limit, i + 80)))?.[0];
    if (!attribute) return null;
    i += attribute.length;
    while (i < limit && isSpace(text[i])) i++;
    if (text[i] !== '=') continue;
    i++;
    while (i < limit && isSpace(text[i])) i++;
    const q = text[i];
    if (q === '"' || q === "'") {
      const close = text.indexOf(q, i + 1);
      if (close === -1 || close >= limit) return null;
      attributes.push({ name: attribute, valueStart: i + 1, valueEnd: close });
      i = close + 1;
    } else if (q === '{') {
      const after = skipBraces(text, i, limit);
      if (after === -1) return null;
      i = after;
    } else {
      while (i < limit && !/[\s>]/.test(text[i]!)) i++;
    }
  }
  return null;
}

/** HTML elements that stand as a block of their own, as a component does. */
const HTML_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'center', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'iframe', 'img', 'li', 'main', 'nav', 'ol', 'p', 'picture', 'section', 'source', 'summary', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'video',
]);
const HTML_HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const isBlockTag = (tag: TagSpan): boolean =>
  tag.name === '' || tag.name === '!--' || /^[A-Z]/.test(tag.name) || HTML_BLOCK_TAGS.has(tag.name);

/** Attributes whose quoted value is text a reader is shown. */
const HUMAN_ATTRIBUTES = new Set(['title', 'caption', 'label', 'description']);

// ---------------------------------------------------------------------------
// Line shapes
// ---------------------------------------------------------------------------

const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;
const THEMATIC_BREAK = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const LIST_MARKER = /^([-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const TABLE_SEPARATOR = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const ALERT_MARKER = /^\[![A-Za-z]+\][ \t]*$/;
/** The first line of an MDX ESM block. */
const ESM_START = /^(?:import\s+(?:['"]|\{|[\w*][^]*?\bfrom\b)|export\s+(?:const|let|var|function|async|class|default|\{|\*))/;

const hasPipe = (text: string): boolean => /(?:^|[^\\])\|/.test(text);

/** The cells of a table line, split on unescaped pipes, the outer pipes dropped. */
function tableCells(text: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (text[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += text[i];
  }
  cells.push(cell.trim());
  if (/^\s*\|/.test(text)) cells.shift();
  if (/(?:^|[^\\])\|\s*$/.test(text)) cells.pop();
  return cells;
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/** One line's share of a paragraph: body offsets, and whether a hard break ends it. */
interface Segment {
  start: number;
  end: number;
  hardBreak: boolean;
}

/** Words whose period never ends a sentence, lowercased, without that period. */
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'vs', 'cf', 'approx', 'incl', 'esp', 'viz', 'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'no',
  'nos', 'fig', 'figs', 'vol', 'eq', 'ca', 'resp',
]);
const TERMINATORS = new Set(['.', '!', '?', '…']);
const CLOSERS = new Set([')', ']', '"', "'", '”', '’', '*', '_', '~']);

/** Past the balanced `open`…`close` pair starting at `at`, or -1 when it does not close within `limit`. */
function skipPair(text: string, at: number, open: string, close: string, limit: number): number {
  let depth = 0;
  for (let j = at; j < limit; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === open) depth++;
    else if (text[j] === close && --depth === 0) return j + 1;
  }
  return -1;
}

/** The longest inline link the scan treats as one opaque piece. */
const LINK_SCAN_CHARS = 2_000;

/**
 * Past an opaque inline construct starting at `i`: a code span, an inline link
 * or image (`[text](destination)`), a tag, comment or autolink, a `{…}`
 * expression. `i` itself when none starts there.
 */
function skipOpaque(text: string, i: number): number {
  const c = text[i];
  if (c === '`') {
    let run = 1;
    while (text[i + run] === '`') run++;
    for (let from = i + run; ; ) {
      const close = text.indexOf('`'.repeat(run), from);
      if (close === -1) return i + run;
      let after = close + run;
      if (text[after] !== '`') return after;
      while (text[after] === '`') after++;
      from = after;
    }
  }
  if (c === '[') {
    const limit = Math.min(text.length, i + LINK_SCAN_CHARS);
    const label = skipPair(text, i, '[', ']', limit);
    if (label === -1 || text[label] !== '(') return i;
    const destination = skipPair(text, label, '(', ')', limit);
    return destination === -1 ? i : destination;
  }
  if (c === '<') {
    const tag = lexTag(text, i);
    if (tag) return tag.end;
    const autolink = /^<[a-z][\w+.-]*:[^\s<>]*>/i.exec(text.slice(i, i + 400));
    return autolink ? i + autolink[0].length : i;
  }
  if (c === '{') {
    const after = skipBraces(text, i, Math.min(text.length, i + TAG_SCAN_CHARS));
    return after === -1 ? i : after;
  }
  return i;
}

/** The word a terminator at `at` closes, its leading punctuation dropped. */
function wordBefore(text: string, at: number): string {
  let from = at;
  while (from > 0 && !/\s/.test(text[from - 1]!)) from--;
  return text.slice(from, at).replace(/^[(["'“‘*_`]+/, '');
}

/**
 * A paragraph cut into sentences: its segments joined by single spaces into one
 * reading text, cut there, and each sentence mapped back to body offsets.
 */
function sentenceSpans(body: string, segments: readonly Segment[]): Array<{ start: number; end: number }> {
  let text = '';
  const toBody: number[] = [];
  const hardBreakAt = new Set<number>();
  segments.forEach((seg, k) => {
    if (k > 0) {
      if (segments[k - 1]!.hardBreak) hardBreakAt.add(text.length);
      text += ' ';
      toBody.push(-1);
    }
    text += body.slice(seg.start, seg.end);
    for (let at = seg.start; at < seg.end; at++) toBody.push(at);
  });

  const spans: Array<{ start: number; end: number }> = [];
  const cut = (from: number, to: number): void => {
    let a = from;
    while (a < to && /\s/.test(text[a]!)) a++;
    let b = to;
    while (b > a && /\s/.test(text[b - 1]!)) b--;
    if (b > a) spans.push({ start: toBody[a]!, end: toBody[b - 1]! + 1 });
  };

  let sentence = 0;
  let i = 0;
  while (i < text.length) {
    if (hardBreakAt.has(i)) {
      cut(sentence, i);
      sentence = ++i;
      continue;
    }
    const skipped = skipOpaque(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    if (!TERMINATORS.has(text[i]!)) {
      i++;
      continue;
    }
    const terminator = i;
    let j = i;
    while (j < text.length && TERMINATORS.has(text[j]!)) j++;
    for (;;) {
      if (j < text.length && CLOSERS.has(text[j]!)) j++;
      else if (text[j] === '<' && text[j + 1] === '/') {
        const tag = lexTag(text, j);
        if (!tag) break;
        j = tag.end;
      } else break;
    }
    if (j >= text.length) break;
    if (!/\s/.test(text[j]!)) {
      i = j;
      continue;
    }
    let k = j;
    while (k < text.length && /\s/.test(text[k]!)) k++;
    if (k >= text.length) break;
    let hardBreak = false;
    for (let p = j; p < k; p++) if (hardBreakAt.has(p)) hardBreak = true;
    const next = text[k]!;
    const word = wordBefore(text, terminator);
    const continues =
      /\p{Ll}/u.test(next) ||
      ',;:)'.includes(next) ||
      (text[terminator] === '.' && (ABBREVIATIONS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word)));
    if (hardBreak || !continues) {
      cut(sentence, j);
      sentence = k;
    }
    i = k;
  }
  cut(sentence, text.length);
  return spans;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/** The non-blank lines of `lines`, cut into parts of at most {@link CODE_UNIT_LINES}, each as a body span. */
function blockParts(body: string, lines: readonly Line[]): Array<{ start: number; end: number }> {
  const parts: Array<{ start: number; end: number }> = [];
  for (let at = 0; at < lines.length; at += CODE_UNIT_LINES) {
    const filled = lines.slice(at, at + CODE_UNIT_LINES).filter((l) => body.slice(l.start, l.end).trim() !== '');
    if (filled.length > 0) parts.push({ start: filled[0]!.start, end: filled[filled.length - 1]!.end });
  }
  return parts;
}

/**
 * The frontmatter's units in line order, and the line the document resumes at:
 * the `title` and `description` values, and between them the runs of every
 * other line, each run cut into parts as a fenced block is.
 */
function frontmatterUnits(body: string, lines: readonly Line[]): { units: UnitDraft[]; next: number } {
  const lineText = (i: number): string => body.slice(lines[i]!.start, lines[i]!.end);
  if (lines.length < 2 || lineText(0) !== '---') return { units: [], next: 0 };
  let close = 1;
  while (close < lines.length && lineText(close).trimEnd() !== '---') close++;
  if (close >= lines.length) return { units: [], next: 0 };
  const blockEnd = lines[close]!.start;

  const units: UnitDraft[] = [];
  let rest: Line[] = [];
  const flushRest = (): void => {
    const parts = blockParts(body, rest);
    parts.forEach((part, p) => units.push({ kind: 'frontmatter', field: null, part: p + 1, parts: parts.length, ...part }));
    rest = [];
  };
  for (let i = 1; i < close; i++) {
    const key = /^(title|description)[ \t]*:[ \t]*/.exec(lineText(i));
    if (!key) {
      rest.push(lines[i]!);
      continue;
    }
    flushRest();
    const field = key[1] === 'title' ? 'title' : 'description';
    const line = lines[i]!;
    const valueAt = line.start + key[0].length;
    const q = body[valueAt];
    if (q === '"' || q === "'") {
      // A quoted scalar, on one line or several; `\"` and `''` escape the quote.
      let j = valueAt + 1;
      while (j < blockEnd) {
        if (q === '"' && body[j] === '\\') j += 2;
        else if (q === "'" && body[j] === "'" && body[j + 1] === "'") j += 2;
        else if (body[j] === q) break;
        else j++;
      }
      const start = valueAt + 1;
      if (j < blockEnd && hasWord(body.slice(start, j))) units.push({ kind: 'frontmatter', field, start, end: j });
      while (i + 1 < close && lines[i + 1]!.start <= j) i++;
      continue;
    }
    // A plain scalar on the key's line, or a block (or empty) one, continued by the more-indented lines below.
    const onLine = !/^(?:[|>][-+]?)?[ \t]*$/.test(body.slice(valueAt, line.end));
    let start = onLine ? valueAt : -1;
    let end = onLine ? trimEnd(body, valueAt, line.end) : -1;
    for (; i + 1 < close && /^[ \t]+\S/.test(lineText(i + 1)); i++) {
      const at = skipSpaces(body, lines[i + 1]!.start, lines[i + 1]!.end);
      if (start === -1) start = at;
      end = trimEnd(body, at, lines[i + 1]!.end);
    }
    if (start !== -1 && hasWord(body.slice(start, end))) units.push({ kind: 'frontmatter', field, start, end });
  }
  flushRest();
  return { units, next: close + 1 };
}

// ---------------------------------------------------------------------------
// The splitter
// ---------------------------------------------------------------------------

interface ListLevel {
  markerIndent: number;
  /** The unit of this level's latest item: the intro of what nests under it. */
  unit: number | null;
}

/**
 * Split a doc body (the whole file, frontmatter included) into its numbered
 * units. Pure and deterministic.
 */
export function splitDocUnits(body: string): DocUnit[] {
  const lines = lineSpans(body);
  const headingAt = new Map(parseHeadings(body.split('\n')).map((h) => [h.line, h.text]));
  const units: DocUnit[] = [];
  let heading: string | null = null;

  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid]!.start <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const push = (draft: UnitDraft): number => {
    const n = units.length + 1;
    units.push({
      ...draft,
      n,
      heading,
      startLine: lineOf(draft.start) + 1,
      endLine: lineOf(Math.max(draft.start, draft.end - 1)) + 1,
      text: body.slice(draft.start, draft.end),
    });
    return n;
  };

  // ---- Block state ----------------------------------------------------------
  let paragraph: Segment[] = [];
  let paragraphQuote = 0;
  /** The item whose first paragraph is still being read. */
  let item: { segments: Segment[]; depth: number; intro: number | null; level: ListLevel } | null = null;
  let list: { levels: ListLevel[]; intro: number | null; quote: number } | null = null;
  let table: { columns: string[]; quote: number } | null = null;

  const flushParagraph = (): void => {
    for (const span of sentenceSpans(body, paragraph)) {
      if (hasWord(body.slice(span.start, span.end))) push({ kind: 'sentence', ...span });
    }
    paragraph = [];
  };
  const flushItem = (): void => {
    if (!item) return;
    const { segments, depth, intro, level } = item;
    item = null;
    const start = segments[0]?.start;
    const end = segments[segments.length - 1]?.end;
    if (start !== undefined && end !== undefined && hasWord(body.slice(start, end))) {
      level.unit = push({ kind: 'item', depth, intro, start, end });
    }
  };
  const flushText = (): void => {
    flushParagraph();
    flushItem();
  };
  const endList = (): void => {
    flushItem();
    list = null;
  };
  /** What introduces a list starting now: the last unit, when it is prose under this heading. */
  const listIntro = (): number | null => {
    const last = units[units.length - 1];
    return last && (last.kind === 'sentence' || last.kind === 'tag') && last.heading === heading ? last.n : null;
  };
  /** The human attributes of the opening tags among `tags`, as units. */
  const tagUnits = (tags: readonly TagSpan[]): void => {
    for (const tag of tags) {
      if (tag.closing) continue;
      for (const attr of tag.attributes) {
        if (!HUMAN_ATTRIBUTES.has(attr.name)) continue;
        const start = skipSpaces(body, attr.valueStart, attr.valueEnd);
        const end = trimEnd(body, start, attr.valueEnd);
        if (hasWord(body.slice(start, end))) push({ kind: 'tag', tag: tag.name, attribute: attr.name, start, end });
      }
    }
  };
  /** A line's prose, its trailing hard break and trailing block tags taken off. */
  const segmentOf = (start: number, end: number): Segment & { closesBlock: boolean } => {
    let hardBreak = end - start >= 2 && body.slice(end - 2, end) === '  ';
    let closesBlock = false;
    let stop = trimEnd(body, start, end);
    for (;;) {
      if (body[stop - 1] === '\\' && body[stop - 2] !== '\\') {
        hardBreak = true;
        stop = trimEnd(body, start, stop - 1);
        continue;
      }
      if (body[stop - 1] !== '>') break;
      const open = body.lastIndexOf('<', stop - 1);
      const tag = open >= start ? lexTag(body, open) : null;
      if (!tag || tag.end !== stop || !isBlockTag(tag)) break;
      if (tag.name === 'br') hardBreak = true;
      else closesBlock = true;
      stop = trimEnd(body, start, open);
    }
    return { start, end: stop, hardBreak, closesBlock };
  };
  /**
   * The tags opening a line at `at`: all of them while only tags follow (a
   * tag may run over several lines), and how far the leading BLOCK tags reach.
   */
  const tagsAt = (
    at: number,
  ): { tags: TagSpan[]; onlyTags: boolean; leading: TagSpan[]; resume: number; resumeLine: number } => {
    const tags: TagSpan[] = [];
    const leading: TagSpan[] = [];
    let p = at;
    let resume = at;
    let blockRun = true;
    for (;;) {
      const tag = body[p] === '<' ? lexTag(body, p) : null;
      if (!tag) break;
      tags.push(tag);
      if (blockRun && isBlockTag(tag)) {
        leading.push(tag);
        resume = skipSpaces(body, tag.end, lines[lineOf(tag.end)]!.end);
      } else blockRun = false;
      p = skipSpaces(body, tag.end, lines[lineOf(tag.end)]!.end);
      if (p >= lines[lineOf(tag.end)]!.end) return { tags, onlyTags: true, leading, resume: p, resumeLine: lineOf(tag.end) };
    }
    return { tags, onlyTags: false, leading, resume, resumeLine: lineOf(resume) };
  };
  /** Emit a fenced block's content as code units; the line after its closing fence. */
  const codeUnits = (open: number, fence: string, lang: string | null, quote: number): number => {
    const content: Line[] = [];
    let i = open + 1;
    for (; i < lines.length; i++) {
      const line = lines[i]!;
      const from = quote > 0 ? quotePrefix(body, line).contentStart : line.start;
      const text = body.slice(skipSpaces(body, from, line.end), line.end).trimEnd();
      if (text[0] === fence[0] && text.length >= fence.length && /^(?:`+|~+)$/.test(text)) {
        i++;
        break;
      }
      content.push(line);
    }
    const parts = blockParts(body, content);
    parts.forEach((part, p) => push({ kind: 'code', lang, part: p + 1, parts: parts.length, ...part }));
    return i;
  };

  const front = frontmatterUnits(body, lines);
  for (const draft of front.units) push(draft);

  let i = front.next;
  while (i < lines.length) {
    const line = lines[i]!;
    const headingText = headingAt.get(i);
    if (headingText !== undefined) {
      flushText();
      endList();
      table = null;
      heading = headingText;
      i++;
      continue;
    }
    const { depth: quote, contentStart } = quotePrefix(body, line);
    const at = skipSpaces(body, contentStart, line.end);
    const indent = columnOf(body, contentStart, at);
    const rest = body.slice(at, line.end);

    if (rest.trim() === '') {
      flushText();
      table = null;
      i++;
      continue;
    }
    if (paragraph.length > 0 && quote !== paragraphQuote) flushParagraph();
    if (list && quote !== list.quote) endList();
    const outdented = (): boolean => list !== null && indent <= list.levels[0]!.markerIndent;

    const fence = FENCE_OPEN.exec(rest);
    if (fence && !(fence[1]![0] === '`' && fence[2]!.includes('`'))) {
      flushText();
      table = null;
      if (outdented()) endList();
      i = codeUnits(i, fence[1]!, fence[2]!.trim().split(/\s+/)[0] || null, quote);
      continue;
    }
    if (rest.startsWith('<!--') || rest.startsWith('{/*')) {
      flushText();
      table = null;
      const closer = rest.startsWith('<!--') ? '-->' : '*/}';
      const close = body.indexOf(closer, at + 3);
      i = close === -1 ? lines.length : lineOf(close) + 1;
      continue;
    }
    if (quote === 0 && at === line.start && ESM_START.test(rest)) {
      flushText();
      endList();
      table = null;
      while (i < lines.length && body.slice(lines[i]!.start, lines[i]!.end).trim() !== '') i++;
      continue;
    }
    if ((paragraph.length > 0 && SETEXT_UNDERLINE.test(rest)) || THEMATIC_BREAK.test(rest) || /^=+[ \t]*$/.test(rest)) {
      flushText();
      table = null;
      i++;
      continue;
    }
    if (table) {
      if (quote === table.quote && hasPipe(rest)) {
        if (tableCells(rest).some((cell) => cell !== '')) {
          push({ kind: 'row', columns: table.columns, start: at, end: trimEnd(body, at, line.end) });
        }
        i++;
        continue;
      }
      table = null;
    }
    const below = lines[i + 1];
    if (below && hasPipe(rest)) {
      const separator = body.slice(skipSpaces(body, quotePrefix(body, below).contentStart, below.end), below.end);
      if (hasPipe(separator) && TABLE_SEPARATOR.test(separator)) {
        flushText();
        if (outdented()) endList();
        table = { columns: tableCells(rest), quote };
        i += 2;
        continue;
      }
    }

    const marker = LIST_MARKER.exec(rest);
    const emptyItem = marker !== null && rest.slice(marker[0].length).trim() === '';
    const notInterrupting =
      paragraph.length > 0 && marker !== null && (emptyItem || (/\d/.test(marker[1]!) && !/^1[.)]$/.test(marker[1]!)));
    if (marker && !notInterrupting) {
      flushText();
      // A marker outdented past the list's first one still continues the list
      // (nothing between them closed it), so it keeps the list's intro.
      if (!list) list = { levels: [], intro: listIntro(), quote };
      const levels = list.levels;
      while (levels.length > 0 && indent < levels[levels.length - 1]!.markerIndent) levels.pop();
      const top = levels[levels.length - 1];
      const level = top && indent <= top.markerIndent ? top : { markerIndent: indent, unit: null };
      if (level !== top) levels.push(level);
      const depth = levels.length - 1;
      const intro = depth > 0 ? (levels[depth - 1]!.unit ?? list.intro) : list.intro;
      item = { segments: [], depth, intro, level };
      const contentAt = skipSpaces(body, at + marker[1]!.length, line.end);
      if (contentAt < line.end) {
        const seg = segmentOf(contentAt, line.end);
        if (seg.end > seg.start) item.segments.push(seg);
        if (seg.closesBlock) flushItem();
      }
      i++;
      continue;
    }

    const opened = body[at] === '<' ? tagsAt(at) : null;
    const expressionLine = rest.startsWith('{') && skipBraces(body, at, line.end) === trimEnd(body, at, line.end);
    const alert = quote > 0 && ALERT_MARKER.test(rest);
    const plainProse = !expressionLine && !alert && !opened?.onlyTags && (opened?.leading.length ?? 0) === 0;

    if (item && plainProse) {
      // A lazy continuation of the item's first paragraph.
      const seg = segmentOf(at, line.end);
      if (seg.end > seg.start) item.segments.push(seg);
      if (seg.closesBlock) flushItem();
      i++;
      continue;
    }
    flushItem();
    if (outdented()) endList();

    if (expressionLine) {
      flushParagraph();
      i++;
      continue;
    }
    if (alert) {
      flushParagraph();
      i++;
      continue;
    }
    if (opened && (opened.onlyTags || opened.leading.length > 0)) {
      flushParagraph();
      if (opened.onlyTags) {
        if (!opened.tags.some((t) => !t.closing && HTML_HEADINGS.has(t.name))) tagUnits(opened.tags);
        i = opened.resumeLine + 1;
        continue;
      }
      tagUnits(opened.leading);
      i = opened.resumeLine + 1;
      if (opened.leading.some((t) => !t.closing && HTML_HEADINGS.has(t.name))) continue;
      const seg = segmentOf(opened.resume, lines[opened.resumeLine]!.end);
      if (seg.end > seg.start) {
        paragraph.push(seg);
        paragraphQuote = quote;
      }
      if (seg.closesBlock) flushParagraph();
      continue;
    }

    const seg = segmentOf(at, line.end);
    if (seg.end > seg.start) {
      paragraph.push(seg);
      paragraphQuote = quote;
    }
    if (seg.closesBlock) flushParagraph();
    i++;
  }
  flushText();
  return units;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** Consecutive units of one doc, `from` to `to` inclusive: the work of one session. */
export interface UnitWindow {
  /** 1-based, in doc order. */
  index: number;
  from: number;
  to: number;
}

export interface UnitWindowBounds {
  maxUnits: number;
  /** The bound on the summed text length of a window's units. */
  maxChars: number;
}

/**
 * Pack a doc's units into windows: whole sections (the consecutive units under
 * one heading) in doc order, as many as fit both bounds. A section over either
 * bound is cut at unit boundaries, and its last piece may share a window with
 * the sections after it; a single unit over the character bound is a window
 * alone. Deterministic: the same units always give the same windows.
 */
export function planUnitWindows(units: readonly DocUnit[], bounds: UnitWindowBounds): UnitWindow[] {
  const sections: DocUnit[][] = [];
  for (const unit of units) {
    const last = sections[sections.length - 1];
    if (last && last[0]!.heading === unit.heading) last.push(unit);
    else sections.push([unit]);
  }
  const fits = (count: number, chars: number): boolean => count <= bounds.maxUnits && chars <= bounds.maxChars;
  const windows: UnitWindow[] = [];
  let open: { from: number; to: number; count: number; chars: number } | null = null;
  for (const section of sections) {
    const chars = section.reduce((sum, u) => sum + u.text.length, 0);
    if (open && !fits(open.count + section.length, open.chars + chars)) {
      windows.push({ index: windows.length + 1, from: open.from, to: open.to });
      open = null;
    }
    for (const unit of section) {
      if (open && !fits(open.count + 1, open.chars + unit.text.length)) {
        windows.push({ index: windows.length + 1, from: open.from, to: open.to });
        open = null;
      }
      if (open) {
        open.to = unit.n;
        open.count += 1;
        open.chars += unit.text.length;
      } else open = { from: unit.n, to: unit.n, count: 1, chars: unit.text.length };
    }
  }
  if (open) windows.push({ index: windows.length + 1, from: open.from, to: open.to });
  return windows;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** The longest intro an item quotes when the unit introducing it is outside the window. */
const INTRO_CHARS = 160;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A code part with the indentation its non-blank lines share taken off. */
function dedent(text: string): string {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const indentOf = (l: string): number => /^[ \t]*/.exec(l)![0].length;
  const common = Math.min(...lines.filter((l) => l.trim() !== '').map(indentOf));
  return lines.map((l) => l.slice(Math.min(common, indentOf(l)))).join('\n');
}

/**
 * One unit as a briefing shows it, numbered, with what it needs to be read
 * alone: a row names its columns, an item the unit introducing its list (by
 * number when that unit is in the window, quoted when it is not), a code part
 * its language and place, a run of frontmatter its place. `units` is the
 * doc's whole list.
 */
export function presentUnit(unit: DocUnit, units: readonly DocUnit[], window: UnitWindow): string {
  const label = `[${unit.n}]`;
  const indented = (text: string): string =>
    dedent(text)
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n');
  switch (unit.kind) {
    case 'frontmatter':
      if (unit.field === null) {
        return `${label} frontmatter${unit.parts > 1 ? ` (part ${unit.part} of ${unit.parts})` : ''}:\n${indented(unit.text)}`;
      }
      return `${label} ${unit.field}: ${oneLine(unit.text)}`;
    case 'sentence':
      return `${label} ${oneLine(unit.text)}`;
    case 'tag':
      return `${label} ${unit.tag} ${unit.attribute}: ${oneLine(unit.text)}`;
    case 'item': {
      const intro = unit.intro === null ? undefined : units[unit.intro - 1];
      const under =
        intro === undefined
          ? ''
          : intro.n >= window.from && intro.n <= window.to
            ? ` (under [${intro.n}])`
            : ` (under "${clip(oneLine(intro.text), INTRO_CHARS)}")`;
      return `${label} ${'  '.repeat(unit.depth)}- ${oneLine(unit.text)}${under}`;
    }
    case 'row': {
      const named = tableCells(unit.text).map((cell, i) => `${unit.columns[i] || `column ${i + 1}`}: ${cell || '(empty)'}`);
      return `${label} row · ${named.join(' · ')}`;
    }
    case 'code': {
      const where = [unit.lang, unit.parts > 1 ? `part ${unit.part} of ${unit.parts}` : null].filter(Boolean).join(', ');
      return `${label} code${where ? ` (${where})` : ''}:\n${indented(unit.text)}`;
    }
  }
}
