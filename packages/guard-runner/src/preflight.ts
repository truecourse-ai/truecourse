/**
 * Entry pre-flight — before ANY scenario (or birth candidate) touches the built
 * entrypoint, prove it can START. A stale/orphaned dist, a missing interpreter, or
 * a module-resolution crash makes EVERY invocation fail identically; without this
 * gate that surfaces as N indistinguishable scenario failures (or birth findings),
 * burying the real cause. A dead binary must be ONE loud entry-level error.
 *
 * The judgment is GENERAL — no language- or tool-specific string matching. The
 * observation it rests on: a program that reaches its own argument handling reacts
 * to its arguments, so DIFFERENT argument vectors produce DIFFERENT output; a
 * program that crashes BEFORE it parses argv (missing module, missing script file,
 * interpreter error, un-spawnable binary) produces the SAME failure for every
 * invocation — its output is invariant under its arguments. So the entry is probed
 * twice, with two distinct argument vectors, and judged DEAD only when
 *
 *   BOTH probes failed  AND  their observable results are byte-identical
 *
 * i.e. the entry never succeeds and never reacts to its input. A healthy CLI passes:
 * either a probe exits cleanly (exit 0), or the probes DIFFER (the bare invocation's
 * usage/exit differs from `--help`). This is exactly why a naive exit-code check is
 * wrong — a healthy CLI legitimately exits nonzero with usage on no-args.
 *
 * BOTH PROBES SHARE ONE SANDBOX (sequentially), so the argv is the ONLY input that
 * varies between them. This is load-bearing: startup crashes embed the resolved
 * script path in their output (a module loader reporting `<cwd>/dist/cli.js` not
 * found), and with per-probe sandboxes the harness's own temp path made two
 * otherwise-identical failures differ — a live false-ALIVE (a recipe entry naming
 * `dist/cli.js` where the build produces `dist/cli.mjs` sailed through). The
 * executor seam receives the shared sandbox world so it cannot recreate that bug.
 *
 * The residual ambiguity is honest and unavoidable without hardcoding: an entry that
 * FAILS identically for every input (e.g. a tool that always errors "config missing"
 * regardless of arguments) is indistinguishable from a dead one — and, for scenario
 * purposes, it is equally unrunnable, so treating it as a startup failure is correct.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createSandbox } from './sandbox.js'
import { executeStep, type StepCapture } from './executor.js'

/**
 * The argument vectors the entry is probed with. Two DISTINCT vectors: a healthy CLI
 * differentiates them (it parses argv) while a crashed-at-startup one cannot. `--help`
 * is inert (never mutates state) and near-universally handled distinctly from no-args.
 */
export const ENTRY_PROBE_ARGVS: readonly (readonly string[])[] = [[], ['--help']]

/** Per-probe hard wall-clock; a probe that hangs before producing output is a startup failure. */
export const ENTRY_PREFLIGHT_TIMEOUT_MS = 20_000

/** One entry probe: the argv appended to the entrypoint and the raw capture it produced. */
export interface EntryProbe {
  argv: string[]
  capture: StepCapture
}

export interface EntryPreflightResult {
  /** True when the entry demonstrably started (a clean exit, or the probes reacted to argv). */
  ok: boolean
  /** Display form of the entry argv, e.g. `node tools/cli/dist/index.js`. */
  entry: string
  /**
   * The full, UNTRUNCATED startup output when the entry is dead — the bare (no-args)
   * probe's stderr, falling back to its stdout, plus any spawn / timeout note; when a
   * path-bearing entry arg is missing on disk, the missing-file diagnostic (with the
   * parent directory's contents) is appended so a `cli.js`/`cli.mjs` mixup is one
   * glance. Empty when the entry started fine.
   */
  stderr: string
  /** Both probes, kept for evidence and tests. */
  probes: EntryProbe[]
}

/** The sandbox world both probes run in — one per preflight, shared. */
export interface EntryProbeWorld {
  cwd: string
  env: NodeJS.ProcessEnv
}

/** Runs one probe (entrypoint + argv) in the SHARED world. Injectable for tests. */
export type EntryProbeExecutor = (
  fullArgv: string[],
  world: EntryProbeWorld,
  timeoutMs: number,
) => Promise<StepCapture>

/** Default executor: run the probe in the shared sandbox world. */
export const defaultEntryProbeExecutor: EntryProbeExecutor = (fullArgv, world, timeoutMs) =>
  executeStep({ argv: fullArgv, cwd: world.cwd, env: world.env, timeoutMs })

export interface PreflightEntryOptions {
  /** The recipe entry resolved to absolute paths (what the child actually runs). */
  resolvedEntry: string[]
  /** The recipe entry as written (repo-relative) — for the readable display command. */
  displayEntry: readonly string[]
  recipeEnv?: Record<string, string>
  /**
   * Repo root — enables the missing-entry-file diagnostic on a dead verdict (the
   * entry as written is checked against the repo the way `resolveEntry` resolves it).
   */
  repoRoot?: string
  /** Per-probe timeout; default {@link ENTRY_PREFLIGHT_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Test seam; production uses {@link defaultEntryProbeExecutor}. */
  exec?: EntryProbeExecutor
}

/**
 * Probe the built entry with {@link ENTRY_PROBE_ARGVS} — sequentially, in ONE shared
 * sandbox — and judge whether it starts. See the module header for the general
 * discriminator and why the sandbox must be shared.
 */
export async function preflightEntry(opts: PreflightEntryOptions): Promise<EntryPreflightResult> {
  const exec = opts.exec ?? defaultEntryProbeExecutor
  const timeoutMs = opts.timeoutMs ?? ENTRY_PREFLIGHT_TIMEOUT_MS
  const entry = opts.displayEntry.join(' ')

  const sandbox = createSandbox({ recipeEnv: opts.recipeEnv })
  const probes: EntryProbe[] = []
  try {
    for (const argv of ENTRY_PROBE_ARGVS) {
      probes.push({
        argv: [...argv],
        capture: await exec([...opts.resolvedEntry, ...argv], { cwd: sandbox.cwd, env: sandbox.env }, timeoutMs),
      })
    }
  } finally {
    sandbox.cleanup()
  }

  const ok = entryStarts(probes)
  return { ok, entry, stderr: ok ? '' : deadEntryOutput(opts, probes[0].capture, timeoutMs), probes }
}

/**
 * True when the entry demonstrably started: any probe reached a clean exit, OR the
 * probes' failures DIFFER (so the entry parsed its arguments and reacted). Only an
 * entry that fails EVERY probe identically — output invariant under its arguments —
 * is judged not to have started.
 */
export function entryStarts(probes: readonly EntryProbe[]): boolean {
  if (probes.some((p) => startedCleanly(p.capture))) return true
  const shapes = probes.map((p) => failureShape(p.capture))
  return shapes.some((s) => s !== shapes[0])
}

/** A probe exited cleanly: no spawn failure, no timeout, no signal, exit code 0. */
function startedCleanly(c: StepCapture): boolean {
  return !c.spawnError && !c.timedOut && c.signal === null && c.exitCode === 0
}

/** A stable serialization of a failing probe's observable result — the discriminator key. */
function failureShape(c: StepCapture): string {
  return JSON.stringify({
    spawnError: c.spawnError ?? null,
    signal: c.signal ?? null,
    timedOut: c.timedOut,
    exitCode: c.exitCode,
    stdout: c.stdout,
    stderr: c.stderr,
  })
}

/** The full diagnostic for a dead entry: startup output + the missing-entry-file hint. */
function deadEntryOutput(opts: PreflightEntryOptions, bare: StepCapture, timeoutMs: number): string {
  const parts = [startupOutput(bare, timeoutMs)]
  if (opts.repoRoot) {
    const missing = missingEntryScript(opts.repoRoot, opts.displayEntry)
    if (missing) parts.push(formatMissingEntryScript(missing))
  }
  return parts.join('\n\n')
}

/** The full startup diagnostic for a dead entry — stderr, else stdout, plus spawn/timeout notes. Never truncated. */
function startupOutput(c: StepCapture, timeoutMs: number): string {
  const parts: string[] = []
  const primary = c.stderr || c.stdout
  if (primary) parts.push(primary.trimEnd())
  if (c.spawnError) parts.push(`failed to spawn: ${c.spawnError}`)
  if (c.timedOut) parts.push(`(the entry produced no output within ${timeoutMs}ms and was killed)`)
  if (parts.length === 0) {
    parts.push(c.exitCode !== null ? `(the entry exited ${c.exitCode} with no output)` : `(the entry was killed by ${c.signal})`)
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Entry-file existence check (deterministic, shared with recipe discovery)
// ---------------------------------------------------------------------------

/** A path-bearing entry arg that does not exist on disk, with what WAS found nearby. */
export interface MissingEntryScript {
  /** The entry arg as written in the recipe. */
  arg: string
  /** The absolute path it resolves to (against the repo root when relative). */
  resolved: string
  /** Repo-relative parent directory, for display. */
  parentDir: string
  /** The parent directory's sorted entries, or `null` when the parent is missing too. */
  siblings: string[] | null
}

/** Most sibling entries listed in the diagnostic before eliding. */
const MAX_SIBLINGS = 25

/**
 * Find the first path-bearing entry arg that does not exist on disk: the command
 * (arg 0) when it is path-anchored rather than a bare PATH lookup, and any later
 * non-flag arg containing a path separator (in an entry argv those are script
 * paths — `['node', 'dist/cli.js']`, `['python', 'src/main.py']`). Relative args
 * resolve against the repo root, mirroring `resolveEntry`. Purely structural — a
 * file-existence check, no output parsing.
 */
export function missingEntryScript(
  repoRoot: string,
  entry: readonly string[],
): MissingEntryScript | null {
  const [command, ...rest] = entry
  const candidates: string[] = []
  if (command && isPathLike(command)) candidates.push(command)
  for (const arg of rest) {
    if (!arg.startsWith('-') && isPathLike(arg)) candidates.push(arg)
  }
  for (const arg of candidates) {
    const resolved = path.isAbsolute(arg) ? arg : path.resolve(repoRoot, arg)
    if (fs.existsSync(resolved)) continue
    const parent = path.dirname(resolved)
    const siblings = fs.existsSync(parent) ? fs.readdirSync(parent).sort() : null
    return {
      arg,
      resolved,
      parentDir: path.isAbsolute(arg) ? parent : path.relative(repoRoot, parent) || '.',
      siblings,
    }
  }
  return null
}

/** Compose the one-glance diagnostic: what's missing and what WAS found next to it. */
export function formatMissingEntryScript(m: MissingEntryScript): string {
  const head = `entry file not found: ${m.arg} (resolved: ${m.resolved})`
  if (m.siblings === null) return `${head}\nits directory ${m.parentDir}/ does not exist`
  if (m.siblings.length === 0) return `${head}\n${m.parentDir}/ is empty`
  const shown = m.siblings.slice(0, MAX_SIBLINGS).join(', ')
  const more = m.siblings.length - MAX_SIBLINGS
  return `${head}\n${m.parentDir}/ contains: ${shown}${more > 0 ? ` … and ${more} more` : ''}`
}

/** An arg is path-like when it is anchored (`./`, `../`) or contains a separator. */
function isPathLike(arg: string): boolean {
  return arg.includes('/') || arg.includes(path.sep) || arg.startsWith('.')
}

/**
 * The one-line headline + rebuild hint for a dead entry — the single source both
 * `guard run` and `guard generate` render, so the two paths never tell different
 * stories. The build command is the recipe's own (no tool-specific assumption).
 */
export function entryPreflightHeadline(entry: string, buildCommand: string): string {
  return `The recipe entry \`${entry}\` failed to start — it crashes before it runs, so every scenario would fail identically. Rebuild it with \`${buildCommand}\` (its build output is likely stale or incomplete), then retry.`
}

/**
 * The full, self-contained error message for a dead entry: the headline plus the
 * UNTRUNCATED startup output. Recorded verbatim in `guard/result.json` errors and
 * surfaced by the dashboard's error view.
 */
export function formatEntryPreflightError(opts: { entry: string; buildCommand: string; stderr: string }): string {
  return [entryPreflightHeadline(opts.entry, opts.buildCommand), '', 'Startup output:', opts.stderr].join('\n')
}
