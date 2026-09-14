/**
 * THE REPO-READING TOOLS every code-reading agent session shares: `read_file`
 * (numbered lines, paged) and `search_repo` (a regex over the working tree).
 * Read-only and bounded — a tool result is context, and context is the budget.
 * Every path the model hands over is untrusted input: `../../.ssh/id_rsa` is a
 * plausible thing for a confused session to ask for, and the honest answer is a
 * tool error it can read and revise on, never a file.
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { Minimatch } from 'minimatch'
import { defineSessionTool, type SessionTool } from '@truecourse/agent-loop'
import { DOC_DISCOVERY_SKIP_DIRS } from '@truecourse/shared'
import { MAX_SOURCE_FILE_BYTES, MAX_SOURCE_RESULT_BYTES, readHint, readSource, resolveSourcePath, sourceLines, sourceView } from './source-view.js'

const MAX_READ_LINES = 400
const MAX_SEARCH_HITS = 60
const MAX_FILE_BYTES = MAX_SOURCE_FILE_BYTES
/** Maximum code points in a search excerpt; source reads use byte-bounded pages. */
export const MAX_LINE_CHARS = 400

export interface FileViewInput {
  /** Repo-relative path, as the session names it. */
  path: string
  /** The lines being shown, in order. */
  lines: readonly string[]
  /** Line number of `lines[0]`, 1-based. */
  start: number
  /** How many lines the whole file has — the tail counts what is not shown. */
  total: number
}

/** `path (N lines)`, numbered lines, and what was left out. */
export function renderFileView({ path, lines, start, total }: FileViewInput): string {
  const body = lines.map((line, index) => `${start + index}\t${line}`).join('\n')
  const shown = start - 1 + lines.length
  const tail = shown < total ? `\n… ${total - shown} more lines` : ''
  return `${path} (${total} lines)\n${body}${tail}`
}

export function readFileTool(repoRoot: string): SessionTool {
  return defineSessionTool({
    name: 'read_file',
    description:
      'Read source in pages of at most 400 lines and 24,000 UTF-8 bytes. Follow the returned start/startColumn continuation to recover omitted text, including long lines. Columns count Unicode code points from 1.',
    kind: 'read-file',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        path: z.string().min(1).describe('Repo-relative path, e.g. `apps/dashboard/client/src/pages/Repo.tsx`'),
        start: z.number().int().positive().optional().describe('First line (1-based). Defaults to 1.'),
        startColumn: z.number().int().positive().optional().describe('One-based Unicode code-point column on the first requested line.'),
        lines: z.number().int().positive().optional().describe(`How many lines (max ${MAX_READ_LINES}).`),
      })
      .strict(),
    async execute(args) {
      let target: string
      try {
        target = resolveSourcePath(repoRoot, args.path)
      } catch (error) {
        return { content: message(error), isError: true }
      }
      let stat: fs.Stats
      try {
        stat = fs.statSync(target)
      } catch {
        return { content: `\`${args.path}\` does not exist.`, isError: true }
      }
      if (stat.isDirectory()) {
        if (args.startColumn !== undefined) return { content: 'startColumn applies to source files, not directories.', isError: true }
        const entries = fs
          .readdirSync(target, { withFileTypes: true })
          .filter((e) => !DOC_DISCOVERY_SKIP_DIRS.has(e.name))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
        const head = `\`${args.path}\` is a directory:\n`
        const shown: string[] = []
        let bytes = Buffer.byteLength(head) + 100
        for (const entry of entries) {
          if (bytes + Buffer.byteLength(entry) + 1 > MAX_SOURCE_RESULT_BYTES) break
          shown.push(entry)
          bytes += Buffer.byteLength(entry) + 1
        }
        return { content: head + shown.join('\n') + (shown.length < entries.length ? `\n… ${entries.length - shown.length} entries omitted by the byte limit; read a subdirectory.` : '') }
      }
      if (stat.size > MAX_FILE_BYTES) {
        return { content: `\`${args.path}\` is ${stat.size} bytes — too large to read.`, isError: true }
      }
      try {
        return { content: sourceView({
          path: args.path, lines: sourceLines(readSource(repoRoot, args.path)),
          start: args.start, startColumn: args.startColumn, maxLines: Math.min(args.lines ?? MAX_READ_LINES, MAX_READ_LINES),
        }).content }
      } catch (error) {
        return { content: message(error), isError: true }
      }
    },
  })
}

/** Read independent source ranges together without multiplying the context budget. */
export function readFilesTool(repoRoot: string): SessionTool {
  return defineSessionTool({
    name: 'read_files',
    description: 'Read up to 8 independent source files/ranges in one call, sharing a 24,000-byte result budget equally. Each result has an exact read_file continuation when partial. Use this for dependencies or several omitted source ranges. Directories use read_file.',
    kind: 'read-file', readOnly: true, destructive: false,
    inputSchema: z.object({ files: z.array(z.object({
      path: z.string().min(1).max(1_024),
      start: z.number().int().positive().optional(),
      startColumn: z.number().int().positive().optional(),
      lines: z.number().int().positive().max(MAX_READ_LINES).optional(),
    }).strict()).min(1).max(8) }).strict(),
    async execute(args) {
      // Each slot includes its separators and errors. Long paths cannot consume another slot.
      const perFile = Math.floor(MAX_SOURCE_RESULT_BYTES / args.files.length) - 2
      const blocks = args.files.map(file => {
        try {
          return sourceView({ ...file, lines: sourceLines(readSource(repoRoot, file.path)),
            maxLines: file.lines ?? MAX_READ_LINES, maxBytes: perFile }).content
        } catch (error) {
          const detail = `${JSON.stringify(file.path)}: ${message(error)}`
          let bounded = ''
          for (const point of detail) {
            if (Buffer.byteLength(bounded) + Buffer.byteLength(point) > perFile - 80) break
            bounded += point
          }
          return `Source read error: ${bounded}${bounded.length < detail.length ? '…' : ''}`
        }
      })
      return { content: blocks.join('\n\n') }
    },
  })
}

export function searchTool(repoRoot: string): SessionTool {
  return defineSessionTool({
    name: 'search_repo',
    description:
      'Search source with a regular expression. Returns up to 60 match-centered excerpts within 24,000 UTF-8 bytes, with one-based line/Unicode column and read_file hints. glob matches repo-relative paths; pathContains is a literal substring filter. Hidden catalog files are not searched; use catalog tools for catalog entries.',
    kind: 'search-repo',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        query: z.string().min(1).describe('JavaScript regular expression, case-sensitive.'),
        glob: z
          .string()
          .min(1)
          .optional()
          .describe('Repo-relative glob: **/*.tsx, packages/ui/**/*.tsx, or **/*.{ts,tsx}. A glob without / matches basenames anywhere. Use pathContains for literal fragments.'),
        pathContains: z.string().min(1).optional().describe('Literal substring of the repo-relative path, e.g. packages/ui/ or .tsx. Combined with glob when both are supplied.'),
      })
      .strict(),
    async execute(args) {
      let pattern: RegExp
      try {
        pattern = new RegExp(args.query)
      } catch (error) {
        return { content: `\`${args.query}\` is not a valid regular expression: ${message(error)}`, isError: true }
      }
      const hits: string[] = []
      const glob = args.glob ? new Minimatch(args.glob.replace(/^\.\//, ''), { matchBase: true, nonegate: true, nocomment: true }) : undefined
      let matchedFiles = 0
      let searchedFiles = 0
      let truncated = false
      let bytes = 0
      for (const file of walk(repoRoot)) {
        const rel = path.relative(repoRoot, file).split(path.sep).join('/')
        if (glob && !glob.match(rel)) continue
        if (args.pathContains && !rel.includes(args.pathContains)) continue
        matchedFiles++
        let text: string
        try {
          if (fs.statSync(file).size > MAX_FILE_BYTES) continue
          text = fs.readFileSync(file, 'utf-8')
        } catch {
          continue
        }
        // A NUL byte means binary — searching it produces noise, never a locator.
        if (text.includes('\0')) continue
        searchedFiles++
        const lines = sourceLines(text)
        for (let i = 0; i < lines.length; i++) {
          const match = pattern.exec(lines[i])
          if (!match) continue
          const column = Array.from(lines[i].slice(0, match.index)).length
          const points = Array.from(lines[i])
          const from = Math.max(0, column - 80)
          const excerpt = points.slice(from, from + MAX_LINE_CHARS).join('')
          const partialMatch = Array.from(match[0]).length > from + MAX_LINE_CHARS - column
          const row = `${rel}:${i + 1}:${column + 1}: ${from ? '…' : ''}${excerpt}${from + MAX_LINE_CHARS < points.length ? '…' : ''}${partialMatch ? ' [match continues]' : ''}\n  ${readHint(rel, { start: i + 1, startColumn: from + 1 })}`
          if (hits.length >= MAX_SEARCH_HITS || bytes + Buffer.byteLength(row) + 100 > MAX_SOURCE_RESULT_BYTES) {
            truncated = true
            break
          }
          hits.push(row)
          bytes += Buffer.byteLength(row) + 1
        }
        if (truncated) break
      }
      if (!matchedFiles) return { content: 'No files matched the path filters in the searchable repository tree. glob uses wildcard syntax; use pathContains for literal fragments. Hidden, vendor and build directories are excluded.' }
      if (!searchedFiles) return { content: `${matchedFiles} files matched the path filters, but none were searchable text files within the 2,000,000-byte limit.` }
      if (hits.length === 0 && !truncated) return { content: (Buffer.byteLength(args.query) < MAX_SOURCE_RESULT_BYTES - 200 ? `No match for \`${args.query}\`.` : 'No match. The query is omitted from this result because of its size.') + ` Searched ${searchedFiles} text files.` }
      return {
        content: hits.join('\n') + (truncated ? `\n… additional matches omitted by the hit or byte limit — narrow the search.` : ''),
      }
    },
  })
}

/** Every text file of the tree, vendor and build directories skipped. */
function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue
    if (DOC_DISCOVERY_SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
