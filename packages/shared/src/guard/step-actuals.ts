/**
 * The ACTUAL half of a step: what one step of one scenario really did in one run.
 * Its counterpart is the AUTHORED half ({@link GuardScenarioStepView}, what the step
 * asserts) — the test detail renders the pair, so every step reads the same way:
 * expected, actual, output.
 *
 * The run's EVIDENCE BUNDLE is where this lives: `invocation.json` already carries one
 * record per executed step (index, exit code / status, duration) and is written for
 * every executed outcome, `pass` included. Its per-step output is head-truncated at
 * write time, so nothing read back here is unbounded, and the whole bundle is
 * gitignored run data — the committable `LATEST.json` stays inline-compact.
 *
 * A step that never executed — the run stopped at an earlier failure, or was cancelled
 * — has no record and therefore no actual. Nothing is invented for it.
 */

import { z } from 'zod'
import { OutputExcerptsSchema } from './excerpts.js'

export const GuardStepActualSchema = z
  .object({
    /** 1-based step index — the same position `GuardScenarioStepView.n` names. */
    n: z.number().int().positive(),
    /**
     * What the step returned, one line: `exit 0` (cli), `status 200` (an api request),
     * `timed out`, or the spawn/request error. Absent when the step returns nothing to
     * report — a `write`/`delete` that spawns no process, an api lifecycle step.
     */
    actual: z.string().optional(),
    /** Wall clock of the step's last executed iteration. */
    durationMs: z.number().nonnegative(),
    /**
     * What the step printed, head-truncated at write time; each stream omitted when it
     * was empty. An api request's response body rides as `stdout`, the same mapping the
     * api driver's failure excerpts use.
     */
    ...OutputExcerptsSchema.shape,
  })
  .strict()
export type GuardStepActual = z.infer<typeof GuardStepActualSchema>

/**
 * One `invocation.json` step record, as either driver writes it. Deliberately
 * permissive: the bundle carries far more per step (argv, headers, captures) than the
 * actual half needs, and a bundle written before per-step output was retained must
 * still read — it simply yields records with no output.
 */
const InvocationStepSchema = z
  .object({
    index: z.number().int().positive(),
    kind: z.string().optional(),
    /** cli: the process exit code; `null` when the child was killed. */
    exitCode: z.number().nullable().optional(),
    /** api: the response status; `null` when no response arrived. */
    status: z.number().nullable().optional(),
    timedOut: z.boolean().optional(),
    spawnError: z.string().optional(),
    requestError: z.string().optional(),
    durationMs: z.number().nonnegative().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    /** api: the response body excerpt (the cli `stdout` analog). */
    body: z.string().optional(),
  })
  .passthrough()

const InvocationSchema = z.object({ steps: z.array(InvocationStepSchema).default([]) }).passthrough()

type InvocationStep = z.infer<typeof InvocationStepSchema>

/** The step kinds that spawn nothing and return nothing — they have no actual line. */
const NO_RESULT_KINDS = new Set(['write', 'delete', 'boot', 'signal', 'logs'])

/** The one-line actual of a record: what the step returned, or nothing when it returns nothing. */
function actualLine(step: InvocationStep): string | undefined {
  if (step.spawnError) return `failed to spawn: ${step.spawnError}`
  if (step.requestError) return `no response: ${step.requestError}`
  if (step.timedOut) return 'timed out'
  if (step.kind && NO_RESULT_KINDS.has(step.kind)) return undefined
  if ('exitCode' in step) return step.exitCode == null ? 'exit (killed)' : `exit ${step.exitCode}`
  if ('status' in step) return step.status == null ? undefined : `status ${step.status}`
  return undefined
}

/**
 * Read an evidence bundle's `invocation.json` as the per-step actuals of that
 * scenario's run. Anything that does not parse as a bundle yields an empty list — the
 * detail then shows the authored half alone, which is the honest reading of "no record
 * of this run exists", never a half-invented one.
 */
export function parseGuardStepActuals(source: string | unknown): GuardStepActual[] {
  let raw: unknown = source
  if (typeof source === 'string') {
    try {
      raw = JSON.parse(source)
    } catch {
      return []
    }
  }
  const parsed = InvocationSchema.safeParse(raw)
  if (!parsed.success) return []
  return parsed.data.steps.map((step) => {
    const line = actualLine(step)
    const stdout = step.stdout ?? step.body
    return {
      n: step.index,
      ...(line !== undefined ? { actual: line } : {}),
      durationMs: step.durationMs ?? 0,
      ...(stdout ? { stdout } : {}),
      ...(step.stderr ? { stderr: step.stderr } : {}),
    }
  })
}
