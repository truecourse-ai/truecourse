/**
 * The FALLBACK cli derivation: ask the program itself. Used only when the tree
 * yields nothing (a framework no extractor recognizes), it walks a fixed ladder —
 * bare invocation → `--help` → one level of `<command> --help` — and reads the
 * command list out of the help text.
 *
 * The ladder NEVER fails. Help that cannot be parsed still yields exactly one ROOT
 * interface (the program itself is an invocable surface), a probe that crashes,
 * times out, or spawns nothing contributes an empty transcript, and the whole walk
 * is bounded by {@link MAX_CLI_PROBES} subprocesses. A mapper that threw here would
 * take the entire spec pipeline down with it.
 */

import { createSandbox, executeStep } from '@truecourse/guard-runner'
import path from 'node:path'
import type { Interface } from '@truecourse/shared'
import { buildCliInterfaces, buildRootCliInterface, type CliInterfaceSeed } from './cli-interfaces.js'

/** Hard ceiling on subprocesses one cli mapping may spawn. */
export const MAX_CLI_PROBES = 24
/** Per-probe wall clock; a hanging `--help` is killed and read as no output. */
export const CLI_PROBE_TIMEOUT_MS = 20_000

/** What one probe observed. `exitCode` is null when the process never finished. */
export interface CliProbeCapture {
  stdout: string
  stderr: string
  exitCode: number | null
}

/** Runs one probe with the FULL argv (entry + probe args). Injectable for tests. */
export type CliProbeExec = (argv: readonly string[]) => Promise<CliProbeCapture>

export interface CliProbeOptions {
  /** The program's argv as it is actually spawned (a resolved recipe entry). */
  entry: readonly string[]
  exec: CliProbeExec
  /** The program's user-facing name — the root interface's entry command. */
  programName?: string
  /** Probe budget; defaults to {@link MAX_CLI_PROBES}. */
  maxProbes?: number
}

const EMPTY_CAPTURE: CliProbeCapture = { stdout: '', stderr: '', exitCode: null }

/**
 * Derive the cli catalog by probing. Always returns at least one interface: the
 * subcommands the help text lists (plus one level of their own subcommands), or
 * the root interface when it lists none.
 */
export async function deriveCliInterfacesFromProbes(opts: CliProbeOptions): Promise<Interface[]> {
  const budget = opts.maxProbes ?? MAX_CLI_PROBES
  const programName = opts.programName ?? programNameOf(opts.entry)
  let spent = 0

  const probe = async (args: string[]): Promise<CliProbeCapture | null> => {
    if (spent >= budget) return null
    spent++
    try {
      return await opts.exec([...opts.entry, ...args])
    } catch {
      return EMPTY_CAPTURE
    }
  }

  const bare = await probe([])
  const help = await probe(['--help'])
  // The usage dialect is read at the ROOT only: a command's own help opens with
  // `<prog> <command> …`, which names the command being probed, not a child.
  const root = parseCliHelp(`${transcript(bare)}\n${transcript(help)}`, { usageProgram: programName })

  if (root.subcommands.length === 0) return [buildRootCliInterface(programName, root.flags)]

  const seeds: CliInterfaceSeed[] = []
  for (const command of root.subcommands) {
    const capture = await probe([command, '--help'])
    // Over budget: the command is still real (the root help listed it), it just
    // has no observed flag set.
    const parsed = capture ? parseCliHelp(transcript(capture)) : EMPTY_HELP
    seeds.push({ path: [command], flags: parsed.flags })
    // One level of expansion: nested commands are read out of the transcript we
    // already have, never probed further.
    for (const nested of parsed.subcommands) seeds.push({ path: [command, nested], flags: [] })
  }

  seeds.sort((a, b) => a.path.join(' ').localeCompare(b.path.join(' ')))
  return buildCliInterfaces(seeds)
}

/** The default executor: a fresh hermetic sandbox per probe, hard timeout, no retries. */
export function createSandboxProbeExec(
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): CliProbeExec {
  return async (argv) => {
    const sandbox = createSandbox({ recipeEnv: opts.env })
    try {
      const capture = await executeStep({
        argv: [...argv],
        cwd: sandbox.cwd,
        env: sandbox.env,
        timeoutMs: opts.timeoutMs ?? CLI_PROBE_TIMEOUT_MS,
      })
      return { stdout: capture.stdout, stderr: capture.stderr, exitCode: capture.exitCode }
    } finally {
      sandbox.cleanup()
    }
  }
}

// ---------------------------------------------------------------------------
// Help parsing
// ---------------------------------------------------------------------------

export interface ParsedCliHelp {
  /** Command words the help text lists, in the order it lists them. */
  subcommands: string[]
  /** Flags the help text documents, canonical long form where one is shown. */
  flags: string[]
}

const EMPTY_HELP: ParsedCliHelp = { subcommands: [], flags: [] }

/** A section heading introducing a command list, across the common help dialects. */
const COMMANDS_HEADING = /^[a-z ]*\b(sub)?commands\b\s*:?\s*$/i
/** A `Usage:` heading, with or without the first usage line on the same line. */
const USAGE_HEADING = /^usage\s*:?\s*(.*)$/i
/** A command word in a help listing (`add`, `db:migrate`, `check-config`). */
const HELP_COMMAND_WORD = /^[a-z][a-z0-9:_-]+$/i

export interface ParseCliHelpOptions {
  /**
   * The program's own name. When given, a `Usage:` section is read as well: each
   * usage line of the form `<program> <word> …` names `<word>` as a command — the
   * hand-rolled dialect (`filecli write <path> <content>`) that prints no
   * `Commands:` section at all. Without the name the section is never read, so
   * `Usage: prog <service>` and prose stay exactly as silent as before.
   */
  usageProgram?: string
}

/**
 * Read the command list and flag set out of one help transcript. Commands come
 * from an explicit `Commands:` / `Available Commands:` / `SUBCOMMANDS:` section,
 * from an argparse-style `{add,list,done}` brace list, or — given the program's
 * name — from `Usage:` lines that invoke it with a bare command word; never from
 * a blind scan of indented lines, which turns wrapped prose into phantom commands.
 */
export function parseCliHelp(text: string, opts: ParseCliHelpOptions = {}): ParsedCliHelp {
  const lines = text.split('\n')
  const subcommands: string[] = []
  const seen = new Set<string>()
  const add = (raw: string): void => {
    const word = raw.replace(/[,:.]+$/, '')
    if (!HELP_COMMAND_WORD.test(word) || seen.has(word)) return
    seen.add(word)
    subcommands.push(word)
  }

  // Section lines, grouped so a wrapped description (indented deeper than its own
  // command) cannot register as a command of its own.
  let inCommands = false
  let inUsage = false
  const sectionLines: { indent: number; text: string }[] = []
  const usageLines: string[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    if (indent === 0) {
      inCommands = COMMANDS_HEADING.test(line.trim())
      const usage = USAGE_HEADING.exec(line.trim())
      inUsage = usage !== null
      if (usage?.[1]) usageLines.push(usage[1].trim())
      continue
    }
    if (inCommands) sectionLines.push({ indent, text: line.trim() })
    if (inUsage) usageLines.push(line.trim())
  }
  if (opts.usageProgram) {
    for (const usage of usageLines) {
      const [program, word] = usage.split(/\s+/)
      if (program === opts.usageProgram && word) add(word)
    }
  }
  if (sectionLines.length > 0) {
    const base = Math.min(...sectionLines.map((l) => l.indent))
    for (const line of sectionLines) {
      if (line.indent !== base) continue
      const first = line.text.split(/\s+/)[0]
      if (first) add(first)
    }
  }

  // argparse prints its subcommands as a brace list under `positional arguments`.
  for (const match of text.matchAll(/\{([a-z0-9][a-z0-9,_:-]*)\}/gi)) {
    for (const entry of match[1].split(',')) add(entry.trim())
  }

  return { subcommands, flags: parseHelpFlags(lines) }
}

/** Flags documented in the transcript: only from lines that START with a dash, so
 *  a flag named in prose or in a usage example is not mistaken for a declaration. */
function parseHelpFlags(lines: readonly string[]): string[] {
  const flags: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('-')) continue
    const long = [...trimmed.matchAll(/--[A-Za-z0-9][\w-]*/g)].map((m) => m[0])
    const chosen = long.length > 0 ? [long[0]] : [...trimmed.matchAll(/(?:^|\s)(-[A-Za-z0-9])(?=[,\s]|$)/g)].map((m) => m[1]).slice(0, 1)
    for (const flag of chosen) {
      if (seen.has(flag)) continue
      seen.add(flag)
      flags.push(flag)
    }
  }
  return flags
}

function transcript(capture: CliProbeCapture | null): string {
  if (!capture) return ''
  return `${capture.stdout}\n${capture.stderr}`
}

/** The program's user-facing name, inferred from the argv it is spawned with:
 *  the last path-like token's basename without its extension (`node dist/cli.js`
 *  → `cli`). Callers that know the real bin name pass it explicitly. */
function programNameOf(entry: readonly string[]): string {
  const last = entry[entry.length - 1] ?? 'cli'
  const base = path.basename(last)
  return base.replace(/\.[^.]+$/, '') || base
}
