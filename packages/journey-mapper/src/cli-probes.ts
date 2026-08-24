/**
 * The FALLBACK cli derivation: ask the program itself. Used only when the tree
 * yields nothing (a framework no extractor recognizes), it walks a fixed ladder —
 * bare invocation → `--help` → one level of `<command> --help` — and reads the
 * command list out of the help text.
 *
 * The ladder NEVER fails. Help that cannot be parsed still yields exactly one ROOT
 * journey (the program itself is an invocable surface), a probe that crashes,
 * times out, or spawns nothing contributes an empty transcript, and the whole walk
 * is bounded by {@link MAX_CLI_PROBES} subprocesses. A mapper that threw here would
 * take the entire spec pipeline down with it.
 */

import { createSandbox, executeStep } from '@truecourse/guard-runner'
import path from 'node:path'
import type { Journey, JourneyCliOption } from '@truecourse/shared'
import { buildCliJourneys, buildRootCliJourney, type CliJourneySeed } from './cli-journeys.js'

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
  /** The program's user-facing name — the root journey's entry command. */
  programName?: string
  /** Probe budget; defaults to {@link MAX_CLI_PROBES}. */
  maxProbes?: number
}

const EMPTY_CAPTURE: CliProbeCapture = { stdout: '', stderr: '', exitCode: null }

/** What the probe ladder observed of the cli surface: the union derivation's
 *  runtime half. */
export interface ProbedCliSurface {
  /** The root transcript's parse: program-level flags + the commands it lists. */
  root: ParsedCliHelp
  /** One seed per listed command, plus one nested level per probed transcript,
   *  path-sorted. */
  seeds: CliJourneySeed[]
  /** The listed commands whose own `--help` actually ran (within budget). */
  probedCommands: Set<string>
}

/**
 * Walk the probe ladder and report what it saw: bare invocation → `--help` → one
 * `<command> --help` per listed command, bounded by the probe budget. Never
 * throws; a crashing probe reads as an empty transcript.
 */
export async function probeCliSurface(opts: CliProbeOptions): Promise<ProbedCliSurface> {
  const budget = opts.maxProbes ?? MAX_CLI_PROBES
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
  const root = parseCliHelp(`${transcript(bare)}\n${transcript(help)}`)

  const seeds: CliJourneySeed[] = []
  const probedCommands = new Set<string>()
  for (const command of root.subcommands) {
    const capture = await probe([command, '--help'])
    // Over budget: the command is still real (the root help listed it), it just
    // has no observed flag set.
    if (capture) probedCommands.add(command)
    const parsed = capture ? parseCliHelp(transcript(capture)) : EMPTY_HELP
    seeds.push({ path: [command], flags: parsed.flags, options: parsed.options })
    // One level of expansion: nested commands are read out of the transcript we
    // already have, never probed further.
    for (const nested of parsed.subcommands) seeds.push({ path: [command, nested], flags: [] })
  }

  seeds.sort((a, b) => a.path.join(' ').localeCompare(b.path.join(' ')))
  return { root, seeds, probedCommands }
}

/**
 * Derive the cli catalog by probing. Always returns at least one journey: the
 * subcommands the help text lists (plus one level of their own subcommands), or
 * the root journey when it lists none.
 */
export async function deriveCliJourneysFromProbes(opts: CliProbeOptions): Promise<Journey[]> {
  const programName = opts.programName ?? programNameOf(opts.entry)
  const surface = await probeCliSurface(opts)
  if (surface.root.subcommands.length === 0) {
    return [buildRootCliJourney(programName, surface.root.flags, surface.root.options)]
  }
  return buildCliJourneys(surface.seeds)
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
  /** The same flags with the metadata their declaration lines carry — value
   *  placeholder, choices, description. One entry per `flags` entry. */
  options: JourneyCliOption[]
}

const EMPTY_HELP: ParsedCliHelp = { subcommands: [], flags: [], options: [] }

/** A section heading introducing a command list, across the common help dialects. */
const COMMANDS_HEADING = /^[a-z ]*\b(sub)?commands\b\s*:?\s*$/i
/** A command word in a help listing (`add`, `db:migrate`, `check-config`). */
const HELP_COMMAND_WORD = /^[a-z][a-z0-9:_-]+$/i

/**
 * Read the command list and flag set out of one help transcript. Commands come
 * from an explicit `Commands:` / `Available Commands:` / `SUBCOMMANDS:` section or
 * from an argparse-style `{add,list,done}` brace list — never from a blind scan of
 * indented lines, which turns wrapped prose into phantom commands.
 */
export function parseCliHelp(text: string): ParsedCliHelp {
  const lines = joinWrappedOptionLines(text.split('\n'))
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
  const sectionLines: { indent: number; text: string }[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    if (indent === 0) {
      inCommands = COMMANDS_HEADING.test(line.trim())
      continue
    }
    if (inCommands) sectionLines.push({ indent, text: line.trim() })
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

  const options = parseHelpOptions(lines)
  return { subcommands, flags: options.map((o) => o.flag), options }
}

/** A line that DECLARES an option: it opens with a well-formed flag token. A
 *  wrapped continuation that merely happens to start with a dash (`-p), 'agent'
 *  (…)`) fails the shape and stays a continuation. */
const OPTION_DECL_LINE = /^-{1,2}[A-Za-z0-9][\w-]*(?:[,=\s[<]|$)/

/**
 * Re-join option lines the help formatter wrapped: a line that is indented
 * DEEPER than the option declaration above it and does not itself declare an
 * option is that option's continuation (commander wraps long descriptions,
 * and their `(choices: …)` clauses, at the description column). Continuations
 * fold in with a single space, so they land in the description half of the
 * gutter split. A line at or above the option's own indent (a section heading,
 * a command row) ends the run.
 */
function joinWrappedOptionLines(lines: readonly string[]): string[] {
  const out: string[] = []
  let optionIndent: number | null = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') {
      optionIndent = null
      out.push(line)
      continue
    }
    const indent = line.length - line.trimStart().length
    if (OPTION_DECL_LINE.test(trimmed)) {
      optionIndent = indent
      out.push(line)
      continue
    }
    if (optionIndent !== null && indent > optionIndent && out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]} ${trimmed}`
      continue
    }
    optionIndent = null
    out.push(line)
  }
  return out
}

/** A value placeholder in a declaration: `<mode>` / `[value]` (commander), or an
 *  ALL-CAPS metavar following the flag (argparse's `--env NAME`). */
const DECL_PLACEHOLDER = /[<[]([^\]>]+)[>\]]|(?:[= ])([A-Z][A-Z0-9_]*)(?=[,\s]|$)/
/** A commander-style enumerated value set in a description: `(choices: "a", "b")`. */
const DESC_CHOICES = /\(choices:\s*([^)]+)\)/

/**
 * Options documented in the transcript: only from lines that START with a dash, so
 * a flag named in prose or in a usage example is not mistaken for a declaration.
 * The flag is chosen exactly as before (canonical long form where one is shown);
 * the DECLARATION half of the line (before the 2+-space description gutter)
 * contributes the value placeholder, the description half its text and choices.
 */
function parseHelpOptions(lines: readonly string[]): JourneyCliOption[] {
  const options: JourneyCliOption[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('-')) continue
    const long = [...trimmed.matchAll(/--[A-Za-z0-9][\w-]*/g)].map((m) => m[0])
    const chosen = long.length > 0 ? [long[0]] : [...trimmed.matchAll(/(?:^|\s)(-[A-Za-z0-9])(?=[,\s]|$)/g)].map((m) => m[1]).slice(0, 1)
    for (const flag of chosen) {
      if (seen.has(flag)) continue
      seen.add(flag)
      options.push(optionFromHelpLine(flag, trimmed))
    }
  }
  return options
}

/** One declaration line's metadata, folded onto its chosen flag. */
function optionFromHelpLine(flag: string, line: string): JourneyCliOption {
  const [decl, ...rest] = line.split(/\s{2,}/)
  const hint = DECL_PLACEHOLDER.exec(decl)
  const valueHint = (hint?.[1] ?? hint?.[2])?.trim()
  let description = rest.join('  ').trim()
  const choicesMatch = DESC_CHOICES.exec(description)
  const choices = choicesMatch
    ? choicesMatch[1]
        .split(',')
        .map((c) => c.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    : []
  if (choicesMatch) description = description.replace(choicesMatch[0], '').replace(/\s{2,}/g, ' ').trim()
  return {
    flag,
    ...(valueHint ? { takesValue: true, valueHint } : {}),
    ...(choices.length > 0 ? { choices } : {}),
    ...(description ? { description } : {}),
  }
}

function transcript(capture: CliProbeCapture | null): string {
  if (!capture) return ''
  return `${capture.stdout}\n${capture.stderr}`
}

/** The program's user-facing name, inferred from the argv it is spawned with:
 *  the last path-like token's basename without its extension (`node dist/cli.js`
 *  → `cli`). Callers that know the real bin name pass it explicitly. */
export function programNameOf(entry: readonly string[]): string {
  const last = entry[entry.length - 1] ?? 'cli'
  const base = path.basename(last)
  return base.replace(/\.[^.]+$/, '') || base
}
