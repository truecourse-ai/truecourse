import { createHash } from 'node:crypto'
import { extname, relative } from 'node:path'
import type { SourceRange, SpecSourceKind } from '@truecourse/shared'

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

export function repoRelativePath(rootDir: string, filePath: string): string {
  return normalizePath(relative(rootDir, filePath))
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function kindForPath(filePath: string): SpecSourceKind {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.md') return 'markdown'
  if (ext === '.mdx') return 'mdx'
  if (ext === '.txt' || ext === '.text') return 'text'
  if (ext === '.json') return 'json'
  if (ext === '.yaml' || ext === '.yml') return 'yaml'
  return 'unsupported'
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

export function trimBlankRange(lines: string[], start: number, end: number): SourceRange | null {
  let first = start
  let last = end

  while (first <= last && lines[first - 1]?.trim() === '') first++
  while (last >= first && lines[last - 1]?.trim() === '') last--

  if (first > last) return null
  return { startLine: first, endLine: last }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function firstLineContaining(lines: string[], needles: string[], fallback = 1): number {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (needles.every((needle) => line.includes(needle))) return index + 1
  }
  return fallback
}
