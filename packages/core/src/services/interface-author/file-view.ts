/**
 * HOW A FILE LOOKS TO A SESSION — one rendering, used by the `read_file` tool
 * and by the cluster pack that hands a module over before anybody asks.
 *
 * They have to agree byte for byte: the pack tells a session "these modules are
 * already provided, do not read them again", and a session that reads one
 * anyway must get back exactly what it was already shown, or the instruction
 * looks like a lie about a different file.
 */

/** A tool result is context, and context is the budget (§3.3). */
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
  const body = lines.map((line, index) => `${start + index}\t${clipLine(line)}`).join('\n')
  const shown = start - 1 + lines.length
  const tail = shown < total ? `\n… ${total - shown} more lines` : ''
  return `${path} (${total} lines)\n${body}${tail}`
}

export function clipLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line
}
