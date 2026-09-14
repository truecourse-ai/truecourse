import fs from 'node:fs'
import path from 'node:path'

export const MAX_SOURCE_FILE_BYTES = 2_000_000
export const MAX_SOURCE_RESULT_BYTES = 24_000
export interface SourcePosition { start: number; startColumn: number }
export interface SourceRange { line: number; startColumn: number; endColumn: number }
export interface SourceView {
  content: string
  complete: boolean
  /** Columns are one-based Unicode code points; endColumn is exclusive. */
  ranges: SourceRange[]
  next?: SourcePosition
}

/** Check both the lexical path and symlink destination before any source read. */
export function resolveSourcePath(repoRoot: string, candidate: string): string {
  const root = path.resolve(repoRoot)
  const target = path.resolve(root, candidate)
  const inside = (base: string, file: string) => {
    const relative = path.relative(base, file)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  }
  if (!inside(root, target) || !inside(fs.realpathSync(root), fs.realpathSync(target))) {
    throw new Error(`\`${candidate}\` is outside the repository — paths are repo-relative`)
  }
  return target
}

export function readSource(repoRoot: string, candidate: string): string {
  const target = resolveSourcePath(repoRoot, candidate)
  const stat = fs.statSync(target)
  if (!stat.isFile()) throw new Error(`\`${candidate}\` is not a source file.`)
  if (stat.size > MAX_SOURCE_FILE_BYTES) throw new Error(`\`${candidate}\` is ${stat.size} bytes — too large to read.`)
  const source = fs.readFileSync(target, 'utf8')
  if (source.includes('\0')) throw new Error(`\`${candidate}\` is binary.`)
  return source
}

/** CRLF is presented as LF; indentation and all source code points are retained. */
export function sourceLines(source: string): string[] { return source.split(/\r?\n/) }

export function readHint(file: string, position: SourcePosition): string {
  return `read_file(${JSON.stringify({ path: file, ...position })})`
}

/** A contiguous, recoverable source page. Reserve the continuation before adding source. */
export function sourceView(input: {
  path: string; lines: readonly string[]; start?: number; startColumn?: number
  maxLines?: number; maxBytes?: number
}): SourceView {
  const { path: file, lines } = input
  const start = input.start ?? 1
  const column = input.startColumn ?? 1
  const maxBytes = input.maxBytes ?? MAX_SOURCE_RESULT_BYTES
  if (!Number.isInteger(start) || start < 1 || start > lines.length) {
    throw new Error(`\`${file}\` has ${lines.length} lines — line ${start} is past the end.`)
  }
  if (!Number.isInteger(column) || column < 1 || column > Array.from(lines[start - 1]).length + 1) {
    throw new Error(`Invalid startColumn ${column} for line ${start} of \`${file}\`.`)
  }
  const header = `${file} (${lines.length} lines)\n`
  const reserve = Buffer.byteLength(`\nPartial source. Continue with ${readHint(file, { start: lines.length + 1, startColumn: MAX_SOURCE_FILE_BYTES + 1 })}`)
  let remaining = maxBytes - Buffer.byteLength(header) - reserve
  const body: string[] = []
  const ranges: SourceRange[] = []
  let next: SourcePosition | undefined
  const stop = Math.min(lines.length, start - 1 + (input.maxLines ?? 400))
  for (let index = start - 1; index < stop; index++) {
    const points = Array.from(lines[index])
    const from = index === start - 1 ? column - 1 : 0
    // The longer label also fits when a full line becomes a partial line.
    const labelReserve = Buffer.byteLength(`${index + 1}:${points.length + 1}\t`) + 1
    let used = 0
    let end = from
    while (end < points.length) {
      const bytes = Buffer.byteLength(points[end])
      if (used + bytes + labelReserve > remaining) break
      used += bytes
      end++
    }
    if ((end === from && from < points.length) || labelReserve > remaining) {
      next = { start: index + 1, startColumn: from + 1 }
      break
    }
    const partial = from > 0 || end < points.length
    const row = `${index + 1}${partial ? `:${from + 1}` : ''}\t${points.slice(from, end).join('')}`
    body.push(row)
    ranges.push({ line: index + 1, startColumn: from + 1, endColumn: end + 1 })
    remaining -= Buffer.byteLength(row) + 1
    if (end < points.length) {
      next = { start: index + 1, startColumn: end + 1 }
      break
    }
    if (index + 1 < lines.length) next = { start: index + 2, startColumn: 1 }
    else next = undefined
  }
  if (!body.length) throw new Error('Source page metadata exceeds its byte budget.')
  const content = header + body.join('\n') + (next ? `\nPartial source. Continue with ${readHint(file, next)}` : '\nEnd of source.')
  return { content, complete: !next && start === 1 && column === 1, ranges, ...(next ? { next } : {}) }
}
