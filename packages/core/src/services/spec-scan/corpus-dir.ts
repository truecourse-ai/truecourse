/**
 * THE CORPUS DIRECTORY — the kept documents written to disk for the scan's
 * computer session (`corpus-review.ts`), which reads them with the backend's
 * own `Read`, `Glob` and `Grep` instead of tools this product defines.
 *
 * Each document lands at its ref under a fresh directory in the OS temp dir,
 * so a path the session read maps back to exactly one doc ref. Never under
 * `~/.claude`: the harness refuses its file tools there. The directory is
 * scratch for one step of one run: it is written the first time a session
 * needs it (a fully cached step writes nothing) and removed when the step
 * ends, however it ends.
 *
 * What a session READ and SEARCHED is taken off its TRANSCRIPT, never off its
 * outcome: the driver records every computer call as a `tool-result` whose
 * artifact holds the call's input, so a successful `Read` names the file and
 * the line window it returned, and a successful `Grep` the pattern it ran. A
 * doc counts as read in full only when those windows cover every line of it.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { ComputerTool, SessionComputer, SessionEvent } from '@truecourse/agent-loop'
import { docBody, type DocCandidate } from '@truecourse/spec-consolidator'
import { docLifecycleFingerprint, docTitle } from './tools.js'

/** Read-only: the sessions over this directory look, and change nothing. */
export const CORPUS_READ_TOOLS: readonly ComputerTool[] = ['Read', 'Glob', 'Grep']

/** The lines the backend's `Read` returns when the call names no `limit`. */
const READ_DEFAULT_LIMIT = 2_000

export interface CorpusDir {
  /** The directory, written on first call. The real path, so the paths the
   *  backend reports resolve against it as given. */
  root(): string
  /** The doc ref a path the session used names, or `undefined` for anything
   *  that is not one of the written docs. */
  refOf(filePath: string): string | undefined
  /** Remove the directory. Idempotent; a directory never written is a no-op. */
  dispose(): void
}

/**
 * The kept docs as a directory, written lazily. A ref that would resolve
 * outside the directory is not written: the session cannot read it, so the
 * transcript never shows it read.
 */
export function corpusDir(docs: readonly DocCandidate[], tmpRoot: string = os.tmpdir()): CorpusDir {
  let root: string | undefined
  // The directory as created and as resolved: the OS temp dir is often behind
  // a symlink (macOS's /var is /private/var), and a session may name either.
  let spellings: string[] = []
  let disposed = false
  const written = new Set<string>()

  const materialize = (): string => {
    if (disposed) throw new Error('the corpus directory was already removed')
    if (root) return root
    const created = fs.mkdtempSync(path.join(tmpRoot, 'tc-scan-docs-'))
    const real = fs.realpathSync(created)
    for (const doc of docs) {
      const dest = path.resolve(real, ...doc.path.split('/'))
      if (!isInside(real, dest)) continue
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, docBody(doc), 'utf-8')
      written.add(doc.path)
    }
    root = real
    spellings = [...new Set([real, created])]
    return real
  }

  return {
    root: materialize,
    refOf(filePath) {
      if (!root) return undefined
      const absolute = path.resolve(root, filePath)
      for (const spelling of spellings) {
        const ref = path.relative(spelling, absolute).split(path.sep).join('/')
        if (written.has(ref)) return ref
      }
      return undefined
    },
    dispose() {
      disposed = true
      if (root) fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

const isInside = (root: string, target: string): boolean => {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * The host variables the backend itself needs to start: where it is installed,
 * whose login it runs on (the macOS keychain is read by user name), and how it
 * reaches the network. The session has no shell, so nothing else is passed.
 */
const BACKEND_ENV = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
] as const

/** The read-only computer a session over the directory gets. */
export function corpusReadingComputer(cwd: string): SessionComputer {
  const env: Record<string, string> = {}
  for (const name of BACKEND_ENV) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return { cwd, tools: CORPUS_READ_TOOLS, env }
}

/** The input a `Read` call carried, as the driver records it on the result. */
const ReadArtifactSchema = z.object({
  input: z.object({
    file_path: z.string(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  }),
})

/** Lines in a doc the way `Read` numbers them: a final newline opens no line. */
function lineCount(body: string): number {
  if (body === '') return 0
  const lines = body.split('\n').length
  return body.endsWith('\n') ? lines - 1 : lines
}

/**
 * The docs among `docs` the TRANSCRIPT shows read in full: the union of the
 * line windows of every successful `Read` of a doc covers each of its lines.
 * A failed call (a file too large to read whole, a wrong path) reads nothing.
 */
export function docsReadInFull(
  events: readonly SessionEvent[],
  dir: Pick<CorpusDir, 'refOf'>,
  docs: readonly DocCandidate[],
): Set<string> {
  const windows = new Map<string, Array<[number, number]>>()
  for (const event of events) {
    if (event.type !== 'tool-result' || event.toolName !== 'Read' || event.isError === true) continue
    const parsed = ReadArtifactSchema.safeParse(event.artifact)
    if (!parsed.success) continue
    const ref = dir.refOf(parsed.data.input.file_path)
    if (!ref) continue
    const start = Math.max(1, Math.trunc(parsed.data.input.offset ?? 1))
    const end = start + Math.max(1, Math.trunc(parsed.data.input.limit ?? READ_DEFAULT_LIMIT)) - 1
    const list = windows.get(ref) ?? []
    list.push([start, end])
    windows.set(ref, list)
  }
  const read = new Set<string>()
  for (const doc of docs) {
    const seen = windows.get(doc.path)
    if (!seen) continue
    const lines = lineCount(docBody(doc))
    let covered = 0
    for (const [start, end] of [...seen].sort((x, y) => x[0] - y[0])) {
      if (start > covered + 1) break
      covered = Math.max(covered, end)
    }
    if (covered >= lines) read.add(doc.path)
  }
  return read
}

/** The input a `Grep` call carried, as the driver records it on the result. */
const GrepArtifactSchema = z.object({ input: z.object({ pattern: z.string() }) })

/**
 * The patterns the TRANSCRIPT shows searched: the `pattern` of every
 * successful `Grep` call, trimmed. A call that matched nothing still searched;
 * a failed one (a pattern the engine refused) searched nothing.
 */
export function grepPatternsRun(events: readonly SessionEvent[]): Set<string> {
  const patterns = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool-result' || event.toolName !== 'Grep' || event.isError === true) continue
    const parsed = GrepArtifactSchema.safeParse(event.artifact)
    if (parsed.success) patterns.add(parsed.data.input.pattern.trim())
  }
  return patterns
}

/**
 * The whole kept corpus as one cache-key part: every doc's ref, content hash
 * and lifecycle. A session over the directory may open any of them, so any
 * change to any of them is a change to its inputs. The lifecycle is in it
 * because the content hash does not cover a doc's frontmatter, and the file
 * the session reads does.
 */
export function corpusFingerprint(docs: readonly DocCandidate[]): string {
  const lines = docs.map((d) => `${d.path}=${d.contentHash}=${docLifecycleFingerprint(d)}`).sort()
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

/** One doc as a briefing lists it: ref, title, size, areas. */
export function corpusDocLine(doc: DocCandidate, areas: readonly string[]): string {
  return `- ${doc.path}  ·  ${docTitle(doc)}  ·  ${doc.size} bytes  ·  ${areas.length > 0 ? areas.join(', ') : 'no area'}`
}

export interface SliceBounds {
  /** Most document bytes in one slice; a single larger doc is a slice alone. */
  maxChars: number
  /** Most docs in one slice. */
  maxDocs?: number
}

/**
 * Split docs into reading slices: grouped by their first area (in id order,
 * docs with no area last), packed in that order, and a group that fits in a
 * slice is never split across two. Deterministic: the same docs and areas
 * always give the same slices.
 */
export function planReadingSlices(
  docs: readonly DocCandidate[],
  areasByDoc: ReadonlyMap<string, readonly string[]>,
  bounds: SliceBounds,
): DocCandidate[][] {
  const maxDocs = bounds.maxDocs ?? Number.POSITIVE_INFINITY
  const groups = new Map<string, DocCandidate[]>()
  for (const doc of [...docs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const primary = [...(areasByDoc.get(doc.path) ?? [])].sort()[0]
    // No area sorts after every id.
    const key = primary === undefined ? '￿' : primary
    const group = groups.get(key) ?? []
    group.push(doc)
    groups.set(key, group)
  }
  const slices: DocCandidate[][] = []
  let current: DocCandidate[] = []
  let used = 0
  const flush = (): void => {
    if (current.length > 0) slices.push(current)
    current = []
    used = 0
  }
  for (const [, group] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const size = group.reduce((n, d) => n + d.size, 0)
    const fitsWhole = size <= bounds.maxChars && group.length <= maxDocs
    if (fitsWhole && (used + size > bounds.maxChars || current.length + group.length > maxDocs)) flush()
    for (const doc of group) {
      if (current.length > 0 && (used + doc.size > bounds.maxChars || current.length + 1 > maxDocs)) flush()
      current.push(doc)
      used += doc.size
    }
  }
  flush()
  return slices
}
