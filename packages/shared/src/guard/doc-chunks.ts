/**
 * Heading-aware chunking — the ONE splitting mechanism every budgeted doc
 * consumer shares. Guard extraction's "views" and spec-scan's overlap
 * windows both plan their per-call slices here, so a doc splits identically
 * everywhere: recursively along its shallowest partitioning heading level until
 * pieces fit the caller's budget, then adjacent pieces greedily repacked up to
 * that budget so calls stay few. A section with no finer heading structure is
 * accepted over budget rather than split mid-section; a headingless ('plain')
 * doc is one chunk regardless of size. The heading model itself (format
 * detection + per-format scanners) lives in doc-format.ts. Node-free on
 * purpose — this module reaches the dashboard client through the root export.
 */

import { hasHeadingModel, scanHeadings } from './doc-format.js'

/**
 * Split a document into its major section slices — the leading preamble (if any)
 * plus each split-level heading and everything under it. The split level is the
 * SHALLOWEST heading level that actually partitions the body into two or more
 * sections, so a doc with a single H1 title over many H2 sections splits at the
 * H2s (the title + front-matter become the preamble slice) rather than yielding
 * one whole-document slice. Fence-aware (a `#` line inside a code block is never a
 * boundary), so example CLI output and shell snippets don't fragment the split.
 */
export function splitTopLevelSections(doc: string, content: string): string[] {
  if (!hasHeadingModel(doc)) return [content]
  const lines = content.split('\n')
  const headings = scanHeadings(doc, lines)
  if (headings.length === 0) return [content]

  const levels = [...new Set(headings.map((h) => h.level))].sort((a, b) => a - b)
  const splitLevel =
    levels.find((l) => headings.filter((h) => h.level === l).length >= 2) ?? levels[0]
  const boundaries = headings.filter((h) => h.level === splitLevel).map((h) => h.line)

  const slices: string[] = []
  if (boundaries[0] > 0) {
    const preamble = lines.slice(0, boundaries[0]).join('\n')
    if (preamble.trim()) slices.push(preamble)
  }
  for (let i = 0; i < boundaries.length; i++) {
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : lines.length
    slices.push(lines.slice(boundaries[i], end).join('\n'))
  }
  return slices
}

/** One planned chunk of a doc: its text and 1-based position in the plan. */
export interface DocChunk {
  text: string
  index: number
  total: number
  /** True for the chunk that starts the doc (the only one holding its lead). */
  isFirst: boolean
}

/**
 * Plan a doc's within-budget chunks: shrink it along its headings, then greedily
 * pack adjacent pieces back up to the budget. One chunk (the whole content) when
 * the doc fits, is headingless ('plain'), or has no finer heading structure to
 * split on.
 */
export function planDocChunks(docPath: string, content: string, budgetChars: number): DocChunk[] {
  const whole: DocChunk[] = [{ text: content, index: 1, total: 1, isFirst: true }]
  if (content.length <= budgetChars) return whole

  const pieces = shrinkToBudget(docPath, content, budgetChars)
  const chunks: string[] = []
  let cur: string[] = []
  let curLen = 0
  const flush = (): void => {
    if (cur.length) chunks.push(cur.join('\n'))
    cur = []
    curLen = 0
  }
  for (const piece of pieces) {
    if (curLen > 0 && curLen + piece.length > budgetChars) flush()
    cur.push(piece)
    curLen += piece.length + 1
  }
  flush()
  if (chunks.length <= 1) return whole
  return chunks.map((text, i) => ({ text, index: i + 1, total: chunks.length, isFirst: i === 0 }))
}

/** Recursively section-split until pieces fit; an unsplittable piece stays whole. */
function shrinkToBudget(docPath: string, content: string, budgetChars: number): string[] {
  if (content.length <= budgetChars) return [content]
  const parts = splitTopLevelSections(docPath, content)
  if (parts.length <= 1) return [content] // no finer heading structure — accept it
  return parts.flatMap((p) => shrinkToBudget(docPath, p, budgetChars))
}
