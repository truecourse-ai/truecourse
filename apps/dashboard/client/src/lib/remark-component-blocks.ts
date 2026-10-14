/**
 * MDX component blocks (`<Steps>`, `<Step title="…">`, `<Tab>`, `<Card>`) read
 * as markdown, the way the shared doc parser reads them.
 *
 * Plain CommonMark knows no components: a line opening with `<Steps>` starts a
 * raw-HTML block that swallows everything up to the next blank line, and an
 * indented line after a blank one is an indented code block. So the text of a
 * component rendered as raw text (its `**bold**` literal), and the sentences
 * inside it carried no positions a conflict mark could be cut at, while the doc
 * parser counts them as prose like any other.
 *
 * This transform finds each component REGION — from a line holding only a
 * component's opening tag to the line that closes it — and rebuilds it: the
 * lines holding only component tags stay raw HTML (the sanitizer drops the
 * unknown tags, as it always did), and every run of lines between them is
 * parsed as markdown with the processor's own parser, its common indentation
 * removed first. Each rebuilt node's position is mapped back onto the source,
 * so the marks cut by source offset land on it. Raw HTML that opens no
 * component (README `<p align>`, `<details>`) is left as CommonMark read it.
 *
 * Runs before every other transform, so admonitions and marks see the rebuilt
 * nodes.
 */

import type { Parent, Root, RootContent } from 'mdast';

/** What the transform needs of the processor it runs in: its parser. */
interface MarkdownParser {
  parse(document: string): { type: string };
}

const isRoot = (node: { type: string }): node is Root => node.type === 'root';

/** One quoted, braced or bare attribute of a JSX tag. */
const ATTRIBUTE = String.raw`\s+[^\s"'<>/={}]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s"'<>]+))?`;
/** One component tag, opening, closing or self-closing: a capitalized name or a fragment. */
const COMPONENT_TAG = String.raw`<(\/?)(?:[A-Z][\w.]*(?:${ATTRIBUTE})*\s*(\/?)|)>`;
/** A line holding nothing but component tags. */
const TAG_LINE = new RegExp(String.raw`^\s*(?:${COMPONENT_TAG}\s*)+$`);

/** How far the component tags on a tag line move the nesting depth. */
function depthChange(line: string): number {
  let change = 0;
  for (const [, closing, selfClosing] of line.matchAll(new RegExp(COMPONENT_TAG, 'g'))) {
    if (closing) change--;
    else if (!selfClosing) change++;
  }
  return change;
}

interface Line {
  text: string;
  /** Source offset of the line's first character. */
  start: number;
  /** 1-based source line number. */
  number: number;
}

export function remarkComponentBlocks(this: MarkdownParser) {
  return (tree: Root, file: { toString(): string }): undefined => {
    const source = String(file);
    walk(tree, source, (document) => {
      const parsed = this.parse(document);
      if (!isRoot(parsed)) throw new Error(`[component-blocks] the parser answered a ${parsed.type}, not a root`);
      return parsed;
    });
  };
}

function walk(parent: Parent, source: string, parse: (document: string) => Root): void {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    const region = child.type === 'html' ? componentRegion(child, source) : null;
    if (!region) {
      if ('children' in child) walk(child, source, parse);
      continue;
    }
    // Every sibling the region reaches is rebuilt; one reaching past it widens it.
    let end = region.end;
    let last = i;
    while (last + 1 < parent.children.length) {
      const next = parent.children[last + 1].position?.start.offset;
      if (next === undefined || next >= end) break;
      last++;
      end = Math.max(end, parent.children[last].position?.end.offset ?? end);
    }
    const rebuilt = rebuild(linesOf(source, region.start, end, region.line), parse);
    parent.children.splice(i, last - i + 1, ...rebuilt);
    i += rebuilt.length - 1;
  }
}

/**
 * The source span of the component an html node opens — from its first line to
 * the line closing that component — or null when its first line is not a
 * component's opening tag. An unclosed component ends with the node.
 */
function componentRegion(
  node: Extract<RootContent, { type: 'html' }>,
  source: string,
): { start: number; end: number; line: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const line = node.position?.start.line;
  if (start === undefined || end === undefined || line === undefined) return null;
  const firstLine = source.slice(start, lineEnd(source, start));
  if (!TAG_LINE.test(firstLine) || depthChange(firstLine) <= 0) return null;
  let depth = 0;
  for (let at = start; at < source.length; at = lineEnd(source, at) + 1) {
    const text = source.slice(at, lineEnd(source, at));
    if (TAG_LINE.test(text)) depth += depthChange(text);
    if (depth <= 0) return { start, end: Math.max(end, lineEnd(source, at)), line };
  }
  return { start, end, line };
}

const lineEnd = (source: string, at: number): number => {
  const newline = source.indexOf('\n', at);
  return newline === -1 ? source.length : newline;
};

function linesOf(source: string, start: number, end: number, firstNumber: number): Line[] {
  const lines: Line[] = [];
  for (let at = start, number = firstNumber; at <= end; at = lineEnd(source, at) + 1, number++) {
    lines.push({ text: source.slice(at, Math.min(lineEnd(source, at), end)), start: at, number });
    if (lineEnd(source, at) >= end) break;
  }
  return lines;
}

/** The region as tag lines kept raw and the runs between them parsed as markdown. */
function rebuild(lines: readonly Line[], parse: (document: string) => Root): RootContent[] {
  const out: RootContent[] = [];
  let run: Line[] = [];
  const flush = (): void => {
    if (run.some((line) => line.text.trim() !== '')) out.push(...parseRun(run, parse));
    run = [];
  };
  for (const line of lines) {
    if (!TAG_LINE.test(line.text)) {
      run.push(line);
      continue;
    }
    flush();
    const indent = line.text.length - line.text.trimStart().length;
    const value = line.text.trim();
    out.push({
      type: 'html',
      value,
      position: {
        start: { line: line.number, column: indent + 1, offset: line.start + indent },
        end: { line: line.number, column: indent + value.length + 1, offset: line.start + indent + value.length },
      },
    });
  }
  flush();
  return out;
}

/**
 * One run of content lines, parsed with their common indentation removed (so an
 * indented line reads as prose, not code), every node's position moved back
 * onto the line and column it came from.
 */
function parseRun(lines: readonly Line[], parse: (document: string) => Root): RootContent[] {
  const indents = lines
    .filter((line) => line.text.trim() !== '')
    .map((line) => line.text.length - line.text.trimStart().length);
  const strip = Math.min(...indents);
  const removed = lines.map((line) => Math.min(strip, line.text.length - line.text.trimStart().length));
  const texts = lines.map((line, k) => line.text.slice(removed[k]));

  // Where each parsed line starts in the parsed document.
  const starts: number[] = [];
  let offset = 0;
  for (const text of texts) {
    starts.push(offset);
    offset += text.length + 1;
  }
  const toSource = (point: { offset?: number }): { line: number; column: number; offset: number } | null => {
    if (point.offset === undefined) return null;
    let k = starts.length - 1;
    while (k > 0 && starts[k] > point.offset) k--;
    const column = point.offset - starts[k] + removed[k];
    return { line: lines[k].number, column: column + 1, offset: lines[k].start + column };
  };
  const relocate = (node: RootContent): void => {
    const start = node.position && toSource(node.position.start);
    const end = node.position && toSource(node.position.end);
    if (start && end) node.position = { start, end };
    else delete node.position;
    if ('children' in node) node.children.forEach(relocate);
  };

  const parsed = parse(texts.join('\n')).children;
  parsed.forEach(relocate);
  return parsed;
}
