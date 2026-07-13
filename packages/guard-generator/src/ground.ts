/**
 * Grounded authoring — before each authoring batch, the engine captures how the
 * real program behaves for the commands the batch's claims name, and injects the
 * transcripts into the prompt so the model authors against observed output instead
 * of guessing. Zero LLM: probes are ordinary subprocess runs in a fresh hermetic
 * sandbox, content-keyed-cached like every other stage.
 *
 *   1. derive   pull backtick command fragments from the claim texts, strip the
 *               program name, dedupe; split into HELP surfaces (bare invocation,
 *               bare `--help`, salvaged subcommand `--help`s) and exact fragments.
 *   2. capture  run each probe (cached) in an empty sandbox against the built
 *               entrypoint, keeping the exit code + truncated stdout/stderr —
 *               helps first, then expansion `--help`s discovered in their output,
 *               then exact fragments, budgeted so helps are never evicted.
 *
 * The transcripts are the empty-world baseline; a claim about a NON-empty world
 * (files/git) still needs its own `setup` block — the prompt says so.
 */

import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { createSandbox, executeStep, type StepCapture } from '@truecourse/guard-runner'

export const GROUND_CACHE_NAME = 'guard/ground'
/** Hard per-probe wall-clock; a probe that hangs is killed and recorded timed-out. */
export const PROBE_TIMEOUT_MS = 20_000
/** Per-stream excerpt cap kept in a transcript (stdout and stderr each). */
export const PROBE_OUTPUT_LIMIT = 1200
/** Most probes captured per authoring batch (both phases together) — over-cap
 *  probes aren't run. Raised to make room for the help-surface probes. */
export const MAX_PROBES_PER_BATCH = 10

/** One captured probe: the appended argv, a display command, exit + output excerpts. */
export interface ProbeTranscript {
  /** The probe argv appended to the entrypoint (empty = the bare invocation). */
  argv: string[]
  /** The command shown after `$` in the prompt (entrypoint + argv). */
  command: string
  /** Process exit code, or null when killed (timeout) or never spawned. */
  exit: number | null
  /** First {@link PROBE_OUTPUT_LIMIT} chars of stdout. */
  stdout: string
  /** First {@link PROBE_OUTPUT_LIMIT} chars of stderr (plus any spawn error). */
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  /** True when the probe hit {@link PROBE_TIMEOUT_MS} and was killed. */
  timedOut: boolean
}

const ProbeTranscriptSchema = z.object({
  argv: z.array(z.string()),
  command: z.string(),
  exit: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  timedOut: z.boolean(),
})

// ---------------------------------------------------------------------------
// Probe derivation (deterministic, LLM-free)
// ---------------------------------------------------------------------------

/** The statically-derived probes, split by capture phase (and by priority). */
export interface StaticProbes {
  /**
   * Phase-1 help surfaces, in priority order: the bare no-args invocation (when a
   * claim named no command), the bare `--help` (ALWAYS — the seed the expansion
   * phase scans for subcommands), then salvaged subcommand `--help`s — for a
   * fragment rejected because it carries value tokens, its leading subcommand
   * prefix + `--help` (`` `add 12.50 lunch` `` → `add --help`). Capped at
   * {@link MAX_PROBES_PER_BATCH}; never evicted by lower-priority classes.
   */
  helps: string[][]
  /**
   * Exact command fragments — a whole backtick fragment whose every token is a
   * subcommand word or a flag. LOWEST priority: captured in phase 2 AFTER the
   * expansion `--help`s, filling whatever slots remain, so a fragment-heavy batch
   * can never starve a help surface. Deduped against `helps`, uncapped here (the
   * two-phase orchestrator budgets them).
   */
  fragments: string[][]
}

/**
 * Phase-1/phase-2 (static) probes for a batch, derived from its claim TEXTS alone
 * — see {@link StaticProbes} for the classes and their priority. An empty batch
 * derives nothing (no claims, no probes).
 */
export function deriveStaticProbes(claimTexts: string[], entry: readonly string[]): StaticProbes {
  if (claimTexts.length === 0) return { helps: [], fragments: [] }
  const programNames = programNamesOf(entry)
  // The bare `--help` is unconditional — reserve its dedupe key up front so a
  // salvaged/exact probe can never duplicate it.
  const seen = new Set<string>([probeKey(['--help'])])
  const salvaged: string[][] = []
  const exact: string[][] = []
  let needBare = false

  const add = (list: string[][], argv: string[]): void => {
    const k = probeKey(argv)
    if (seen.has(k)) return
    seen.add(k)
    list.push(argv)
  }

  for (const text of claimTexts) {
    let yielded = false
    for (const fragment of backtickFragments(text)) {
      const probe = classifyFragment(fragment, programNames)
      if (probe.kind === 'none') continue
      yielded = true
      if (probe.kind === 'bare') needBare = true
      else if (probe.kind === 'exact') add(exact, probe.argv)
      else add(salvaged, probe.argv) // 'salvage'
    }
    if (!yielded) needBare = true
  }

  const helps: string[][] = []
  if (needBare) helps.push([])
  helps.push(['--help'])
  helps.push(...salvaged)
  return { helps: helps.slice(0, MAX_PROBES_PER_BATCH), fragments: exact }
}

/** Chars a help-output token may contain to be an expansion candidate — a lowercase
 *  subcommand word of at least three chars. */
const EXPANSION_TOKEN = /^[a-z][a-z0-9-]{2,}$/

/**
 * Phase-2 (expansion) probes: scan the BARE and `--help` transcripts' stdout+stderr
 * for candidate subcommand tokens ({@link EXPANSION_TOKEN}) that ALSO appear
 * (word-boundary) in the batch's claim texts, are not program names, and whose head
 * is not already covered by a salvaged `--help` — each becomes a `<token> --help`
 * probe. The caller fills whatever slots remain under the cap with these; false
 * positives just waste a slot.
 */
export function deriveExpansionProbes(
  transcripts: ProbeTranscript[],
  claimTexts: string[],
  entry: readonly string[],
  alreadyProbedHeads: ReadonlySet<string>,
): string[][] {
  const programNames = programNamesOf(entry)
  const claimBlob = claimTexts.join('\n').toLowerCase()
  const out: string[][] = []
  const seen = new Set<string>()
  for (const t of transcripts) {
    if (!isHelpSurfaceProbe(t.argv)) continue
    for (const token of scanCandidateTokens(`${t.stdout}\n${t.stderr}`)) {
      if (!EXPANSION_TOKEN.test(token)) continue
      if (programNames.has(token) || alreadyProbedHeads.has(token) || seen.has(token)) continue
      if (!wordBoundaryIncludes(claimBlob, token)) continue
      seen.add(token)
      out.push([token, '--help'])
    }
  }
  return out
}

function probeKey(argv: string[]): string {
  return argv.join('\0')
}

/** Backtick-quoted fragments in a claim, in order. */
function backtickFragments(text: string): string[] {
  const out: string[] = []
  const re = /`([^`]+)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out
}

/** How a backtick fragment maps to a probe (or nothing). */
type FragmentProbe =
  | { kind: 'none' }
  | { kind: 'bare' }
  | { kind: 'exact'; argv: string[] }
  | { kind: 'salvage'; argv: string[] }

/**
 * Classify a backtick fragment. A leading token matching the entrypoint program
 * name (or `truecourse`) is stripped; a fragment that was ONLY the program name is
 * the bare probe. A fragment whose every remaining token is a subcommand word or a
 * flag is an EXACT probe; a fragment carrying a value token is SALVAGED to its
 * leading subcommand prefix + `--help` (nothing when there is no such prefix).
 */
function classifyFragment(fragment: string, programNames: Set<string>): FragmentProbe {
  const tokens = fragment.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { kind: 'none' }
  if (programNames.has(tokens[0]) || programNames.has(path.basename(tokens[0]))) tokens.shift()
  if (tokens.length === 0) return { kind: 'bare' } // was just the program name
  if (tokens.every(isCommandToken)) return { kind: 'exact', argv: tokens }
  const prefix = salvagePrefix(tokens)
  return prefix.length > 0 ? { kind: 'salvage', argv: [...prefix, '--help'] } : { kind: 'none' }
}

/**
 * The leading subcommand path of a fragment that carries value tokens: the run of
 * lowercase subcommand words at the front (a flag or value ends the run). When that
 * run has more than one word AND a VALUE (not a flag) ended it, the trailing word is
 * the key/arg that consumes the value (`config set currency EUR` → `config set`), so
 * it is dropped — but never below one word.
 */
function salvagePrefix(tokens: string[]): string[] {
  const prefix: string[] = []
  let i = 0
  while (i < tokens.length && isSubcommandWord(tokens[i])) prefix.push(tokens[i++])
  if (prefix.length === 0) return []
  const terminator = tokens[i]
  const endedByValue = terminator !== undefined && !isSubcommandWord(terminator) && !isFlag(terminator)
  if (prefix.length > 1 && endedByValue) prefix.pop()
  return prefix
}

/** A subcommand word (lowercase, hyphenated) or a flag (`-x`, `--xy`, `--xy=val`). */
function isCommandToken(token: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(token) || isFlag(token)
}

/** A lowercase subcommand word (never a value or a flag). */
function isSubcommandWord(token: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(token)
}

function isFlag(token: string): boolean {
  return /^--?[A-Za-z0-9][\w-]*(=.*)?$/.test(token)
}

/** The bare (empty-argv) or bare `--help` probe — the surfaces that list subcommands. */
function isHelpSurfaceProbe(argv: string[]): boolean {
  return argv.length === 0 || (argv.length === 1 && argv[0] === '--help')
}

/** Lowercase word-ish tokens in help output (split on anything but [a-z0-9-]). */
function scanCandidateTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)
}

/** True when `token` appears in `haystack` on word boundaries. */
function wordBoundaryIncludes(haystack: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(haystack)
}

/** Program names a leading fragment token is stripped against. */
function programNamesOf(entry: readonly string[]): Set<string> {
  const names = new Set<string>(['truecourse'])
  if (entry.length > 0) {
    addName(names, entry[0])
    addName(names, entry[entry.length - 1])
  }
  return names
}

/** Add a basename and its extensionless stem (a program named `cli.js` is `cli`). */
function addName(set: Set<string>, arg: string): void {
  const base = path.basename(arg)
  if (base) set.add(base)
  const stem = base.replace(/\.[^.]+$/, '')
  if (stem) set.add(stem)
}

// ---------------------------------------------------------------------------
// Probe execution + caching
// ---------------------------------------------------------------------------

/** Runs one probe (entrypoint + argv) and returns its raw capture. Injectable for tests. */
export type ProbeExecutor = (
  fullArgv: string[],
  recipeEnv: Record<string, string> | undefined,
) => Promise<StepCapture>

/** Default executor: a fresh empty sandbox (recipe env only), 20s hard timeout. */
export const defaultProbeExecutor: ProbeExecutor = async (fullArgv, recipeEnv) => {
  const sandbox = createSandbox({ recipeEnv })
  try {
    return await executeStep({ argv: fullArgv, cwd: sandbox.cwd, env: sandbox.env, timeoutMs: PROBE_TIMEOUT_MS })
  } finally {
    sandbox.cleanup()
  }
}

export interface CaptureProbesOptions {
  repoRoot: string
  /** The probe argvs to capture (one phase's worth — see {@link groundProbes}). */
  probes: string[][]
  /** The recipe entry resolved to absolute paths (what the child actually runs). */
  resolvedEntry: string[]
  /** The recipe entry as written (repo-relative) — for the readable display command. */
  displayEntry: readonly string[]
  /** The recipe input fingerprint — the cache key's stable component. */
  recipeFingerprint: string
  recipeEnv?: Record<string, string>
  /** Test seam; production uses {@link defaultProbeExecutor}. */
  exec?: ProbeExecutor
  /** Fired once as each probe's transcript resolves (cache hit or fresh capture) — a live-counter seam. */
  onProbeCaptured?: () => void
}

/**
 * Capture each probe's transcript, content-keyed-cached under `guard/ground` on
 * `(recipeFingerprint, argv)` — a cache hit runs NO subprocess. Transcripts are
 * returned in probe order. Probes are deterministic given the recipe, so the key
 * needs nothing more (the caller only reaches here once the build succeeded).
 */
export async function captureProbes(opts: CaptureProbesOptions): Promise<ProbeTranscript[]> {
  const exec = opts.exec ?? defaultProbeExecutor
  return Promise.all(
    opts.probes.map(async (argv) => {
      const key = groundCacheKey(opts.recipeFingerprint, argv)
      const cached = await getCacheEntry(opts.repoRoot, GROUND_CACHE_NAME, key)
      if (cached) {
        const parsed = ProbeTranscriptSchema.safeParse(cached)
        if (parsed.success) {
          opts.onProbeCaptured?.()
          return parsed.data
        }
      }
      const capture = await exec([...opts.resolvedEntry, ...argv], opts.recipeEnv)
      const transcript = toTranscript(argv, [...opts.displayEntry, ...argv], capture)
      await setCacheEntry(opts.repoRoot, GROUND_CACHE_NAME, key, transcript)
      opts.onProbeCaptured?.()
      return transcript
    }),
  )
}

export interface GroundProbesOptions {
  repoRoot: string
  /** The batch's claim texts — the probe-derivation input. */
  claimTexts: string[]
  /** The recipe entry resolved to absolute paths (what the child actually runs). */
  resolvedEntry: string[]
  /** The recipe entry as written (repo-relative) — display command + derivation. */
  displayEntry: readonly string[]
  /** The recipe input fingerprint — the cache key's stable component. */
  recipeFingerprint: string
  recipeEnv?: Record<string, string>
  /** Test seam; production uses {@link defaultProbeExecutor}. */
  exec?: ProbeExecutor
  /** Fired with each PHASE's probe count as it is planned — a live-planned seam
   *  (the total grows when the expansion phase adds its probes). */
  onProbesPlanned?: (count: number) => void
  /** Forwarded to capture: fired once as each probe's transcript resolves. */
  onProbeCaptured?: () => void
}

/**
 * Ground a batch in two phases: capture the help surfaces (bare, `--help`,
 * salvaged subcommand `--help`s), then derive subcommand-`--help` expansion probes
 * from the bare/`--help` transcripts and capture those — followed by the exact
 * command fragments — into whatever slots remain under
 * {@link MAX_PROBES_PER_BATCH}. Expansion helps are admitted BEFORE fragments, so
 * a fragment-heavy batch can never starve a help surface (the priority order:
 * bare → `--help` → subcommand `--help`s → exact fragments). Caching is unchanged
 * — `(recipeFingerprint, argv)`; only the derivation is two-phase. Returns every
 * transcript, phase-1 then phase-2.
 */
export async function groundProbes(opts: GroundProbesOptions): Promise<ProbeTranscript[]> {
  const { helps, fragments } = deriveStaticProbes(opts.claimTexts, opts.displayEntry)
  if (helps.length === 0) return []

  const capture = (probes: string[][]): Promise<ProbeTranscript[]> =>
    captureProbes({
      repoRoot: opts.repoRoot,
      probes,
      resolvedEntry: opts.resolvedEntry,
      displayEntry: opts.displayEntry,
      recipeFingerprint: opts.recipeFingerprint,
      recipeEnv: opts.recipeEnv,
      exec: opts.exec,
      onProbeCaptured: opts.onProbeCaptured,
    })

  opts.onProbesPlanned?.(helps.length)
  const phase1 = await capture(helps)

  const budget = MAX_PROBES_PER_BATCH - helps.length
  if (budget <= 0) return phase1
  // Expansion skips heads a salvaged `--help` already covers. An exact FRAGMENT
  // does not suppress its head's expansion — `add --list` shows behavior, not the
  // flag signature `add --help` exists to reveal.
  const salvagedHeads = new Set(
    helps.map((p) => p[0]).filter((t): t is string => Boolean(t) && t !== '--help'),
  )
  const expansion = deriveExpansionProbes(phase1, opts.claimTexts, opts.displayEntry, salvagedHeads)

  // Phase 2: expansion helps first, then exact fragments, deduped and budgeted.
  const seen = new Set(helps.map(probeKey))
  const phase2: string[][] = []
  for (const argv of [...expansion, ...fragments]) {
    if (phase2.length >= budget) break
    const k = probeKey(argv)
    if (seen.has(k)) continue
    seen.add(k)
    phase2.push(argv)
  }
  if (phase2.length === 0) return phase1

  opts.onProbesPlanned?.(phase2.length)
  return [...phase1, ...(await capture(phase2))]
}

/** Cache key: recipe fingerprint + the probe argv (resolved entry is machine-specific, excluded). */
function groundCacheKey(recipeFingerprint: string, argv: string[]): string {
  return createHash('sha256').update(`${recipeFingerprint}::${argv.join(' ')}`).digest('hex')
}

function toTranscript(argv: string[], displayArgv: string[], capture: StepCapture): ProbeTranscript {
  let rawStderr = capture.stderr
  if (capture.spawnError) rawStderr = rawStderr ? `${rawStderr}\nfailed to spawn: ${capture.spawnError}` : `failed to spawn: ${capture.spawnError}`
  const out = truncate(capture.stdout)
  const err = truncate(rawStderr)
  return {
    argv,
    command: displayArgv.join(' '),
    exit: capture.exitCode,
    stdout: out.text,
    stderr: err.text,
    stdoutTruncated: out.truncated,
    stderrTruncated: err.truncated,
    timedOut: capture.timedOut,
  }
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= PROBE_OUTPUT_LIMIT) return { text, truncated: false }
  return { text: text.slice(0, PROBE_OUTPUT_LIMIT), truncated: true }
}
