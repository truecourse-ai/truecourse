import {
  createSpecChunkId,
  type SourceRange,
  type SpecChunk,
  type SpecSourceKind,
} from '@truecourse/shared'
import { SPEC_PROSE_EXTRACTOR } from './constants.js'
import { kindForPath, sha256, splitLines, trimBlankRange } from './utils.js'

interface Heading {
  line: number
  level: number
  text: string
}

function findMarkdownHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = []
  let inFence = false
  let fenceMarker = ''

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    const fenceMatch = trimmed.match(/^(```+|~~~+)/)
    if (fenceMatch) {
      const marker = fenceMatch[1]![0]!
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      return
    }

    if (inFence) return

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (!headingMatch) return

    headings.push({
      line: index + 1,
      level: headingMatch[1]!.length,
      text: headingMatch[2]!.trim(),
    })
  })

  return headings
}

function headingPathFor(headingStack: Heading[], heading: Heading): string[] {
  while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= heading.level) {
    headingStack.pop()
  }
  headingStack.push(heading)
  return headingStack.map((item) => item.text)
}

function createChunk(sourceFile: string, lines: string[], range: SourceRange, headingPath: string[]): SpecChunk {
  const text = lines.slice(range.startLine - 1, range.endLine).join('\n').trim()
  const hash = sha256(text)

  return {
    id: createSpecChunkId({
      sourceFile,
      sourceRange: range,
      text,
      extractorVersion: SPEC_PROSE_EXTRACTOR.version,
    }),
    sourceFile,
    sourceRange: range,
    headingPath,
    text,
    hash,
    extractor: SPEC_PROSE_EXTRACTOR,
  }
}

export function parseMarkdownSpec(sourceFile: string, content: string): SpecChunk[] {
  const lines = splitLines(content)
  const headings = findMarkdownHeadings(lines)
  const chunks: SpecChunk[] = []

  if (headings.length === 0) {
    const range = trimBlankRange(lines, 1, lines.length)
    return range ? [createChunk(sourceFile, lines, range, [])] : []
  }

  const preambleEnd = headings[0]!.line - 1
  const preambleRange = trimBlankRange(lines, 1, preambleEnd)
  if (preambleRange) chunks.push(createChunk(sourceFile, lines, preambleRange, []))

  const stack: Heading[] = []
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]!
    const nextSameOrHigher = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level)
    const endLine = nextSameOrHigher ? nextSameOrHigher.line - 1 : lines.length
    const range = trimBlankRange(lines, heading.line, endLine)
    if (!range) continue

    chunks.push(createChunk(sourceFile, lines, range, headingPathFor(stack, heading)))
  }

  return chunks
}

function isTextBoundary(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (/^[A-Z][A-Z0-9 ,'"()/&:-]{2,}$/.test(trimmed)) return true
  if (/^[A-Z][\w '"()/&:-]{2,}:$/.test(trimmed)) return true
  return false
}

export function parseTextSpec(sourceFile: string, content: string): SpecChunk[] {
  const lines = splitLines(content)
  const boundaries: number[] = []

  lines.forEach((line, index) => {
    if (isTextBoundary(line)) boundaries.push(index + 1)
  })

  if (boundaries.length === 0) {
    const chunks: SpecChunk[] = []
    let start: number | null = null

    for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
      const isBlank = lines[lineNumber - 1]?.trim() === ''
      if (!isBlank && start === null) start = lineNumber
      if ((isBlank || lineNumber === lines.length) && start !== null) {
        const end = isBlank ? lineNumber - 1 : lineNumber
        const range = trimBlankRange(lines, start, end)
        if (range) chunks.push(createChunk(sourceFile, lines, range, []))
        start = null
      }
    }

    return chunks
  }

  return boundaries.flatMap((startLine, index) => {
    const endLine = index + 1 < boundaries.length ? boundaries[index + 1]! - 1 : lines.length
    const range = trimBlankRange(lines, startLine, endLine)
    return range ? [createChunk(sourceFile, lines, range, [lines[startLine - 1]!.trim().replace(/:$/, '')])] : []
  })
}

export function parseSpecContent(sourceFile: string, content: string, kind: SpecSourceKind = kindForPath(sourceFile)): SpecChunk[] {
  if (kind === 'markdown' || kind === 'mdx') return parseMarkdownSpec(sourceFile, content)
  if (kind === 'text') return parseTextSpec(sourceFile, content)
  return []
}
