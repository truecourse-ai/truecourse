/**
 * Grounded authoring — before each authoring batch, the engine captures how the
 * real program behaves for the commands the batch's claims name, and injects the
 * transcripts into the prompt so the model authors against observed output instead
 * of guessing. Zero LLM: probes are ordinary subprocess runs in a fresh hermetic
 * sandbox, content-keyed-cached like every other stage.
 *
 *   1. derive   pull backtick command fragments from the claim texts, strip the
 *               program name, dedupe, cap; add the bare invocation when a claim
 *               named no command (the program's default/help surface).
 *   2. capture  run each probe (cached) in an empty sandbox against the built
 *               entrypoint, keeping the exit code + truncated stdout/stderr.
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
/** Most probes captured per authoring batch — over-cap fragments aren't probed. */
export const MAX_PROBES_PER_BATCH = 6

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

/**
 * Derive the probes for a batch from its claim TEXTS: each backtick-quoted command
 * fragment, with a leading program name stripped, deduped across the batch, capped
 * at {@link MAX_PROBES_PER_BATCH}. The bare no-args invocation is included when any
 * claim named no command (so a claim with nothing to probe still shows the default
 * surface). Non-command fragments (filenames, fields, paths) are ignored.
 */
export function deriveProbes(claimTexts: string[], entry: readonly string[]): string[][] {
  const programNames = programNamesOf(entry)
  const commandProbes: string[][] = []
  const seen = new Set<string>()
  let needBare = false

  for (const text of claimTexts) {
    let yielded = false
    for (const fragment of backtickFragments(text)) {
      const argv = toProbeArgv(fragment, programNames)
      if (!argv) continue
      yielded = true
      if (argv.length === 0) {
        needBare = true
        continue
      }
      const k = argv.join('\0')
      if (seen.has(k)) continue
      seen.add(k)
      commandProbes.push(argv)
    }
    if (!yielded) needBare = true
  }

  // Bare first so it survives the cap — it's the most broadly useful surface.
  const all = needBare ? [[] as string[], ...commandProbes] : commandProbes
  return all.slice(0, MAX_PROBES_PER_BATCH)
}

/** Backtick-quoted fragments in a claim, in order. */
function backtickFragments(text: string): string[] {
  const out: string[] = []
  const re = /`([^`]+)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out
}

/**
 * A backtick fragment → probe argv, or null when it is not a command invocation.
 * A leading token matching the entrypoint program name (or `truecourse`) is
 * stripped; a fragment that was ONLY the program name becomes the bare probe
 * (empty argv). Every remaining token must be a subcommand word or a flag.
 */
function toProbeArgv(fragment: string, programNames: Set<string>): string[] | null {
  const tokens = fragment.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  if (programNames.has(tokens[0]) || programNames.has(path.basename(tokens[0]))) tokens.shift()
  if (tokens.length === 0) return [] // was just the program name → bare invocation
  for (const t of tokens) if (!isCommandToken(t)) return null
  return tokens
}

/** A subcommand word (lowercase, hyphenated) or a flag (`-x`, `--xy`, `--xy=val`). */
function isCommandToken(token: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(token) || /^--?[A-Za-z0-9][\w-]*(=.*)?$/.test(token)
}

/**
 * Program names a leading token is stripped/compared against: `truecourse` plus the
 * basename and extensionless stem of the entry's first and last args (a program named
 * `cli.js` matches `cli`). Shared with the generator's run[]-composition check so both
 * decide "is this token the program itself?" the same way.
 */
export function programNamesOf(entry: readonly string[]): Set<string> {
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
  /** The probe argvs (from {@link deriveProbes}) to capture. */
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
