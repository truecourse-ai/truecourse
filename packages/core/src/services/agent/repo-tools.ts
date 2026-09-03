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
import { defineSessionTool, type SessionTool } from '@truecourse/agent-loop'
import { DOC_DISCOVERY_SKIP_DIRS } from '@truecourse/shared'

const MAX_READ_LINES = 400
const MAX_SEARCH_HITS = 60
const MAX_FILE_BYTES = 2_000_000
/** How wide one shown line may be — a minified bundle must not eat a turn. */
export const MAX_LINE_CHARS = 400

/** Resolve a repo-relative path INSIDE the repo, or throw. */
function resolveInside(repoRoot: string, candidate: string): string {
  const root = path.resolve(repoRoot)
  const target = path.resolve(root, candidate)
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`\`${candidate}\` is outside the repository — paths are repo-relative`)
  }
  return target
}

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
  const body = lines.map((line, index) => `${start + index}\t${clipLine(line)}`).join('\n')
  const shown = start - 1 + lines.length
  const tail = shown < total ? `\n… ${total - shown} more lines` : ''
  return `${path} (${total} lines)\n${body}${tail}`
}

export function clipLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line
}

export function readFileTool(repoRoot: string): SessionTool {
  return defineSessionTool({
    name: 'read_file',
    description:
      'Read a repo-relative source file. Returns numbered lines. Use `start` and `lines` to page through a long file; at most 400 lines come back per call.',
    kind: 'read-file',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        path: z.string().min(1).describe('Repo-relative path, e.g. `apps/dashboard/client/src/pages/Repo.tsx`'),
        start: z.number().int().positive().optional().describe('First line (1-based). Defaults to 1.'),
        lines: z.number().int().positive().optional().describe(`How many lines (max ${MAX_READ_LINES}).`),
      })
      .strict(),
    async execute(args) {
      let target: string
      try {
        target = resolveInside(repoRoot, args.path)
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
        const entries = fs
          .readdirSync(target, { withFileTypes: true })
          .filter((e) => !DOC_DISCOVERY_SKIP_DIRS.has(e.name))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
        return { content: `\`${args.path}\` is a directory:\n${entries.join('\n')}` }
      }
      if (stat.size > MAX_FILE_BYTES) {
        return { content: `\`${args.path}\` is ${stat.size} bytes — too large to read.`, isError: true }
      }
      const all = fs.readFileSync(target, 'utf-8').split('\n')
      const start = args.start ?? 1
      const count = Math.min(args.lines ?? MAX_READ_LINES, MAX_READ_LINES)
      const slice = all.slice(start - 1, start - 1 + count)
      if (slice.length === 0) {
        return { content: `\`${args.path}\` has ${all.length} lines — line ${start} is past the end.`, isError: true }
      }
      return {
        content: renderFileView({ path: args.path, lines: slice, start, total: all.length }),
      }
    },
  })
}

export function searchTool(repoRoot: string): SessionTool {
  return defineSessionTool({
    name: 'search_repo',
    description:
      'Search the working tree for a regular expression. Returns `path:line: text`, at most 60 hits. Narrow with `glob` (a suffix or a path fragment) when a term is common.',
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
          .describe('Keep only paths containing this fragment or ending in this suffix, e.g. `.tsx`.'),
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
      let truncated = false
      for (const file of walk(repoRoot)) {
        const rel = path.relative(repoRoot, file)
        if (args.glob && !rel.includes(args.glob) && !rel.endsWith(args.glob)) continue
        let text: string
        try {
          if (fs.statSync(file).size > MAX_FILE_BYTES) continue
          text = fs.readFileSync(file, 'utf-8')
        } catch {
          continue
        }
        // A NUL byte means binary — searching it produces noise, never a locator.
        if (text.includes('\0')) continue
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (!pattern.test(lines[i])) continue
          if (hits.length >= MAX_SEARCH_HITS) {
            truncated = true
            break
          }
          hits.push(`${rel}:${i + 1}: ${clipLine(lines[i].trim())}`)
        }
        if (truncated) break
      }
      if (hits.length === 0) return { content: `No match for \`${args.query}\`.` }
      return {
        content: hits.join('\n') + (truncated ? `\n… stopped at ${MAX_SEARCH_HITS} hits — narrow the search.` : ''),
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
