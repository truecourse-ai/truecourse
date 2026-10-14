/**
 * Mark the sentences a conflict points at, in the rendered document.
 *
 * The sentence splitter gives each sentence its character range in the source,
 * and remark gives each node its range too, so a mark is cut where the two
 * meet: inside a paragraph the text runs are split at the sentence's ends and
 * everything between them (text, bold, a code span, a link) wrapped in ONE
 * `<mark>`, and a code block the sentence lies in is wrapped whole in a marked
 * `<div>`. A block of raw HTML is left alone: a tag's sentence is nothing the
 * page renders. Runs after every other transform so no later plugin reshapes a
 * mark.
 *
 * A text run's value is shorter than its source when the parser stripped the
 * indentation of a wrapped line or a backslash escape; both are walked past so
 * the offsets still line up. An entity reference (`&amp;`) is not, and a run
 * holding one is marked whole rather than mis-cut.
 */

import type { Parent, Root, RootContent } from 'mdast';

export interface SentenceRange {
  /** The sentence's key, carried as `data-sentence` so the viewer can scroll to it. */
  key: string;
  /** Character offsets in the source, end exclusive. */
  start: number;
  end: number;
}

/** Hast property name a mark carries its sentence key on. */
export const SENTENCE_MARK = 'dataSentence';

export function remarkSentenceMarks(ranges: readonly SentenceRange[]) {
  return (tree: Root, file: { toString(): string }): undefined => {
    if (ranges.length > 0) walk(tree, ranges, String(file));
  };
}

interface Span {
  start: number;
  end: number;
}

const spanOf = (node: RootContent): Span | null => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : { start, end };
};

/** Inline content: what a paragraph, heading or table cell holds. */
const PHRASING = new Set<string>([
  'text',
  'inlineCode',
  'strong',
  'emphasis',
  'delete',
  'link',
  'linkReference',
  'image',
  'imageReference',
  'break',
  'html',
  'footnoteReference',
  'textDirective',
]);

function walk(parent: Parent, ranges: readonly SentenceRange[], source: string): void {
  if (parent.children.length > 0 && parent.children.every((child) => PHRASING.has(child.type))) {
    markInline(parent, ranges, source);
    return;
  }
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    const span = spanOf(child);
    if (span && !ranges.some((r) => r.start < span.end && r.end > span.start)) continue;
    if (child.type === 'code') {
      const hit = ranges.find((r) => span && r.start < span.end && r.end > span.start);
      if (hit) parent.children[i] = wrap([child], 'div', hit.key);
    } else if ('children' in child) {
      walk(child, ranges, source);
    }
  }
}

/** An inline node, and the sentence it lies wholly inside (null: none). */
interface Piece {
  node: RootContent;
  key: string | null;
}

/**
 * Mark a run of inline content: text is cut at every sentence end, then each
 * run of neighbouring pieces one sentence covers is wrapped in ONE mark, so a
 * sentence with bold, code or a link in it is one highlight, not one per piece.
 * A node a sentence only partly covers is marked inside; one with nothing
 * inside to cut (a code span, an image) is marked whole.
 */
function markInline(parent: Parent, ranges: readonly SentenceRange[], source: string): void {
  const pieces: Piece[] = [];
  for (const child of parent.children) {
    const span = spanOf(child);
    const hits = span ? ranges.filter((r) => r.start < span.end && r.end > span.start) : [];
    if (!span || hits.length === 0) {
      pieces.push({ node: child, key: null });
      continue;
    }
    const covering = hits.find((r) => r.start <= span.start && span.end <= r.end);
    if (child.type === 'text') {
      pieces.push(...cutText(child.value, source.slice(span.start, span.end), span, hits));
    } else if (covering) {
      pieces.push({ node: child, key: covering.key });
    } else if ('children' in child) {
      markInline(child, hits, source);
      pieces.push({ node: child, key: null });
    } else {
      // A tag the sentence only partly covers stays out: half a tag pair in a
      // mark would close it at the mark's edge.
      pieces.push({ node: child, key: child.type === 'html' ? null : hits[0].key });
    }
  }

  const out: RootContent[] = [];
  for (let k = 0; k < pieces.length; ) {
    const { key } = pieces[k];
    let j = k + 1;
    if (key !== null) while (j < pieces.length && pieces[j].key === key) j++;
    out.push(key === null ? pieces[k].node : wrap(pieces.slice(k, j).map((p) => p.node), 'mark', key));
    k = j;
  }
  parent.children = out;
}

/**
 * For each index of `value`, its offset in `src`; null when the two differ by
 * more than stripped indentation, carriage returns and backslash escapes.
 */
function alignToSource(src: string, value: string): number[] | null {
  const map: number[] = [];
  let i = 0;
  for (let j = 0; j < value.length; j++) {
    while (i < src.length && src[i] !== value[j]) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\\') i++;
      else return null;
    }
    if (i >= src.length) return null;
    map.push(i);
    i++;
  }
  return map;
}

/** A text run cut at each sentence end, each piece with the sentence it lies in. */
function cutText(value: string, src: string, span: Span, hits: readonly SentenceRange[]): Piece[] {
  const map = alignToSource(src, value);
  if (!map) return [{ node: { type: 'text', value }, key: hits[0].key }];
  // The value index where a source offset lands: the first character at or after it.
  const indexAt = (offset: number): number => {
    const j = map.findIndex((m) => m >= offset - span.start);
    return j === -1 ? value.length : j;
  };
  const cuts = new Set([0, value.length]);
  for (const r of hits) {
    cuts.add(indexAt(r.start));
    cuts.add(indexAt(r.end));
  }
  const at = [...cuts].sort((a, b) => a - b);
  const out: Piece[] = [];
  for (let k = 0; k + 1 < at.length; k++) {
    const piece = value.slice(at[k], at[k + 1]);
    if (!piece) continue;
    const offset = span.start + map[at[k]];
    const hit = hits.find((r) => r.start <= offset && offset < r.end);
    out.push({ node: { type: 'text', value: piece }, key: hit?.key ?? null });
  }
  return out;
}

/** Nodes wrapped in the element that marks them, carrying the sentence key. */
function wrap(nodes: RootContent[], hName: 'mark' | 'div', key: string): RootContent {
  const marked = { type: 'sentenceMark', data: { hName, hProperties: { [SENTENCE_MARK]: key } }, children: nodes };
  return marked as unknown as RootContent;
}
