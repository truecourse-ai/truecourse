/**
 * Mark the sentences a conflict points at, in the rendered document.
 *
 * The sentence splitter gives each sentence its character range in the source,
 * and remark gives each node its range too, so a mark is cut where the two
 * meet: the text runs a sentence covers are split at its ends and the inside
 * wrapped in a `<mark>`, a code span inside it is marked whole, and a code
 * block the sentence lies in is wrapped whole in a marked `<div>`. Raw HTML is
 * left alone: a tag's sentence is nothing the page renders. Runs after every
 * other transform so no later plugin reshapes a mark.
 *
 * A text run's value is shorter than its source when the parser stripped the
 * indentation of a wrapped line or a backslash escape; both are walked past so
 * the offsets still line up. An entity reference (`&amp;`) is not, and a run
 * holding one is marked whole rather than mis-cut.
 */

import type { Parent, Root, RootContent, Text } from 'mdast';

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

function walk(parent: Parent, ranges: readonly SentenceRange[], source: string): void {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    const span = spanOf(child);
    if (!span) {
      if ('children' in child) walk(child, ranges, source);
      continue;
    }
    const hits = ranges.filter((r) => r.start < span.end && r.end > span.start);
    if (hits.length === 0) continue;
    if (child.type === 'text') {
      const pieces = splitText(child.value, source.slice(span.start, span.end), span, hits);
      parent.children.splice(i, 1, ...pieces);
      i += pieces.length - 1;
    } else if (child.type === 'inlineCode') {
      parent.children[i] = wrap(child, 'mark', hits[0].key);
    } else if (child.type === 'code') {
      parent.children[i] = wrap(child, 'div', hits[0].key);
    } else if ('children' in child) {
      walk(child, ranges, source);
    }
  }
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

function splitText(value: string, src: string, span: Span, hits: readonly SentenceRange[]): RootContent[] {
  const map = alignToSource(src, value);
  if (!map) return [wrap({ type: 'text', value }, 'mark', hits[0].key)];
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
  const out: RootContent[] = [];
  for (let k = 0; k + 1 < at.length; k++) {
    const piece = value.slice(at[k], at[k + 1]);
    if (!piece) continue;
    const offset = span.start + map[at[k]];
    const hit = hits.find((r) => r.start <= offset && offset < r.end);
    const text: Text = { type: 'text', value: piece };
    out.push(hit ? wrap(text, 'mark', hit.key) : text);
  }
  return out;
}

/** A node wrapped in the element that marks it, carrying the sentence key. */
function wrap(node: RootContent, hName: 'mark' | 'div', key: string): RootContent {
  const marked = { type: 'sentenceMark', data: { hName, hProperties: { [SENTENCE_MARK]: key } }, children: [node] };
  return marked as unknown as RootContent;
}
