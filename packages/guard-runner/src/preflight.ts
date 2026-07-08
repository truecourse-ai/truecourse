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
 * program that crashes BEFORE it parses argv (missing module, interpreter error,
 * un-spawnable binary) produces the SAME failure for every invocation — its output
 * is invariant under its arguments. So the entry is probed twice, with two distinct
 * argument vectors, in fresh sandboxes, and judged DEAD only when
 *
 *   BOTH probes failed  AND  their observable results are byte-identical
 *
 * i.e. the entry never succeeds and never reacts to its input. A healthy CLI passes:
 * either a probe exits cleanly (exit 0), or the probes DIFFER (the bare invocation's
 * usage/exit differs from `--help`). This is exactly why a naive exit-code check is
 * wrong — a healthy CLI legitimately exits nonzero with usage on no-args.
 *
 * The residual ambiguity is honest and unavoidable without hardcoding: an entry that
 * FAILS identically for every input (e.g. a tool that always errors "config missing"
 * regardless of arguments) is indistinguishable from a dead one — and, for scenario
 * purposes, it is equally unrunnable, so treating it as a startup failure is correct.
 */

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
   * probe's stderr, falling back to its stdout, plus any spawn / timeout note. Empty
   * when the entry started fine.
   */
  stderr: string
  /** Both probes, kept for evidence and tests. */
  probes: EntryProbe[]
}

/** Runs one probe (entrypoint + argv) and returns its raw capture. Injectable for tests. */
export type EntryProbeExecutor = (
  fullArgv: string[],
  recipeEnv: Record<string, string> | undefined,
  timeoutMs: number,
) => Promise<StepCapture>

/** Default executor: a fresh empty sandbox (recipe env only, isolated HOME/cwd/tmp). */
export const defaultEntryProbeExecutor: EntryProbeExecutor = async (fullArgv, recipeEnv, timeoutMs) => {
  const sandbox = createSandbox({ recipeEnv })
  try {
    return await executeStep({ argv: fullArgv, cwd: sandbox.cwd, env: sandbox.env, timeoutMs })
  } finally {
    sandbox.cleanup()
  }
}

export interface PreflightEntryOptions {
  /** The recipe entry resolved to absolute paths (what the child actually runs). */
  resolvedEntry: string[]
  /** The recipe entry as written (repo-relative) — for the readable display command. */
  displayEntry: readonly string[]
  recipeEnv?: Record<string, string>
  /** Per-probe timeout; default {@link ENTRY_PREFLIGHT_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Test seam; production uses {@link defaultEntryProbeExecutor}. */
  exec?: EntryProbeExecutor
}

/**
 * Probe the built entry with {@link ENTRY_PROBE_ARGVS} (in parallel, fresh sandboxes)
 * and judge whether it starts. See the module header for the general discriminator.
 */
export async function preflightEntry(opts: PreflightEntryOptions): Promise<EntryPreflightResult> {
  const exec = opts.exec ?? defaultEntryProbeExecutor
  const timeoutMs = opts.timeoutMs ?? ENTRY_PREFLIGHT_TIMEOUT_MS
  const entry = opts.displayEntry.join(' ')

  const probes: EntryProbe[] = await Promise.all(
    ENTRY_PROBE_ARGVS.map(async (argv) => ({
      argv: [...argv],
      capture: await exec([...opts.resolvedEntry, ...argv], opts.recipeEnv, timeoutMs),
    })),
  )

  const ok = entryStarts(probes)
  return { ok, entry, stderr: ok ? '' : startupOutput(probes[0].capture, timeoutMs), probes }
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
