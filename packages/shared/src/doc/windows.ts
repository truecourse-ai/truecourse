/**
 * A doc's WINDOWS: the runs of consecutive sentences one session reads or
 * records in a pass. One planner serves every paged reading of a doc: the
 * record stage, bounded by a sentence count and a character budget, and the
 * read tools and briefings, bounded by characters alone, which show a long doc
 * one window at a time. A window's TEXT is a run of the doc's lines, so a doc's
 * windows rejoin to the whole doc: a heading, a blank line and whatever else is
 * not a sentence belongs to the window of the first sentence after it.
 */

import type { DocTree } from './tree.js'

export interface DocWindow {
  /** 1-based, in doc order. */
  index: number
  /** The window's sentences, 1-based inclusive; `from: 1, to: 0` for a doc with none. */
  from: number
  to: number
  /** The window's lines, 1-based inclusive. */
  startLine: number
  endLine: number
}

export interface WindowBounds {
  /** The most sentences a window holds; unbounded when absent. */
  maxSentences?: number
  /** The bound on the summed text length of a window's sentences. */
  maxChars: number
}

/**
 * Pack a doc's sentences into windows: whole sections (the consecutive
 * sentences under one heading) in doc order, as many as fit both bounds. A
 * section over either bound is cut at sentence boundaries, and its last piece
 * may share a window with the sections after it; a single sentence over the
 * character bound is a window alone. A doc with no sentences is one window
 * holding every line. Deterministic: the same doc always gives the same windows.
 */
export function planWindows(tree: DocTree, bounds: WindowBounds): DocWindow[] {
  const { sentences, lines, headings } = tree
  const maxSentences = bounds.maxSentences ?? Number.POSITIVE_INFINITY
  const fits = (count: number, chars: number): boolean => count <= maxSentences && chars <= bounds.maxChars

  const sections: (typeof sentences)[number][][] = []
  for (const sentence of sentences) {
    const last = sections[sections.length - 1]
    if (last && last[0]!.heading === sentence.heading) last.push(sentence)
    else sections.push([sentence])
  }
  const ranges: Array<{ from: number; to: number }> = []
  let open: { from: number; to: number; count: number; chars: number } | null = null
  const close = (): void => {
    if (open) ranges.push({ from: open.from, to: open.to })
    open = null
  }
  for (const section of sections) {
    const chars = section.reduce((sum, s) => sum + s.text.length, 0)
    if (open && !fits(open.count + section.length, open.chars + chars)) close()
    for (const sentence of section) {
      if (open && !fits(open.count + 1, open.chars + sentence.text.length)) close()
      if (open) {
        open.to = sentence.n
        open.count += 1
        open.chars += sentence.text.length
      } else open = { from: sentence.n, to: sentence.n, count: 1, chars: sentence.text.length }
    }
  }
  close()
  if (ranges.length === 0) return [{ index: 1, from: 1, to: 0, startLine: 1, endLine: lines.length }]

  // A window's lines run to the line before the next window's first line: the
  // heading right above that window's first sentence when one sits between the
  // two windows, else that sentence's own first line.
  const starts = ranges.map((range, i) => {
    if (i === 0) return 1
    const previousEnd = sentences[ranges[i - 1]!.to - 1]!.endLine
    const first = sentences[range.from - 1]!.startLine
    const heading = headings.find((h) => h.line + 1 > previousEnd && h.line + 1 <= first)
    return heading ? heading.line + 1 : first
  })
  return ranges.map((range, i) => ({
    index: i + 1,
    from: range.from,
    to: range.to,
    startLine: starts[i]!,
    endLine: i + 1 < starts.length ? starts[i + 1]! - 1 : lines.length,
  }))
}

/** A window's text: its lines, verbatim. */
export function windowText(tree: DocTree, window: Pick<DocWindow, 'startLine' | 'endLine'>): string {
  return tree.lines.slice(window.startLine - 1, window.endLine).join('\n')
}
