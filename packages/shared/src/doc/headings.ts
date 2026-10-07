/**
 * The heading scan every reading of a document shares: the fence-aware ATX
 * scan the tree, the sentence splitter and the window planner are built on,
 * and the extension check that says whether a doc is markdown at all.
 * Node-free: the dashboard client reads documents with this too.
 */

import { hasMarkdownExtension } from '../fs/doc-extensions.js'

export function isMarkdownDoc(docPath: string): boolean {
  return hasMarkdownExtension(docPath)
}

/** One ATX heading occurrence: its level, trimmed text, and 0-based line. */
export interface RawHeading {
  level: number
  text: string
  line: number
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** Fence-aware ATX heading scan — a `#` line inside a code block never counts. */
export function parseHeadings(lines: readonly string[]): RawHeading[] {
  const headings: RawHeading[] = []
  let fenceChar: '`' | '~' | null = null
  let fenceLen = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = FENCE.exec(line)

    if (fenceChar) {
      // Only a same-or-longer run of the opening char, with nothing after it,
      // closes the fence (per CommonMark).
      if (fence && fence[1][0] === fenceChar && fence[1].length >= fenceLen && fence[2].trim() === '') {
        fenceChar = null
        fenceLen = 0
      }
      continue
    }
    if (fence) {
      fenceChar = fence[1][0] as '`' | '~'
      fenceLen = fence[1].length
      continue
    }

    const m = ATX_HEADING.exec(line)
    if (!m) continue
    const text = (m[2] ?? '').trim()
    if (!text) continue // a bare `##` yields no anchor
    headings.push({ level: m[1].length, text, line: i })
  }
  return headings
}
