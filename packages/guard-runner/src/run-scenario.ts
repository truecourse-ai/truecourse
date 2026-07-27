/**
 * Run one scenario end-to-end in its own sandbox: seed → execute steps (stopping
 * at the first failing step) → map to a `GuardScenarioResult`. A spawn failure,
 * timeout, or setup escape is an `error` (infrastructure); an unmet expectation is
 * a `fail` (code-side drift candidate). Evidence is written for every EXECUTED
 * outcome — pass included (a green transcript is the proof of what ran) — but not
 * for a setup error that escaped before any step ran, which has nothing to transcribe.
 */

import type { GuardCliScenario, GuardExpect, GuardScenarioResult, OutputExcerpts } from '@truecourse/shared'
import { createSandbox, SandboxError, DETERMINISM_PINS } from './sandbox.js'
import { overlayStepEnv } from './child-env.js'
import { applyCapabilities, CapabilityError } from './capabilities/index.js'
import { executeStep, type StepCapture } from './executor.js'
import { normalize, type NormalizerContext } from './normalizers.js'
import { applyUnique, applyUniqueEnv, applyUniqueSetup } from './unique.js'
import { evaluateExpect } from './expect.js'
import { writeEvidence, type EvidenceStep } from './evidence.js'

// Evidence records the exact determinism pins the sandbox applied — one source,
// so what evidence claims can never drift from what the child actually saw.
const ENV_PINS = DETERMINISM_PINS

/**
 * Per-stream cap on the RAW output excerpts attached to a mismatch `failure`.
 * Mirrors the probe-transcript convention (`PROBE_OUTPUT_LIMIT` in the guard
 * generator's `ground.ts`) so the retry/finding evidence stays a manageable size.
 */
export const FAILURE_OUTPUT_LIMIT = 1200

/**
 * The RAW (un-normalized) stdout/stderr excerpts to ride next to a mismatch — each
 * head-truncated to {@link FAILURE_OUTPUT_LIMIT}, each stream omitted when it was
 * empty (no empty-string noise). Spread onto the `failure` at the mismatch site so
 * the birth-retry and the finding see the usage error the program actually printed.
 */
function outputExcerpts(capture: StepCapture): OutputExcerpts {
  const out: OutputExcerpts = {}
  if (capture.stdout) out.stdout = capture.stdout.slice(0, FAILURE_OUTPUT_LIMIT)
  if (capture.stderr) out.stderr = capture.stderr.slice(0, FAILURE_OUTPUT_LIMIT)
  return out
}

export interface RunScenarioContext {
  repoRoot: string
  runId: string
  resolvedEntry: string[]
  /**
   * This scenario's `${unique}` token — substituted into the scenario-authored
   * `run` argv and `stdin` (never the recipe-owned `resolvedEntry`) so a resource
   * the scenario creates carries a run-unique, sibling-unique identifier. Stable
   * across the scenario's steps (see {@link scenarioUnique}).
   */
  unique: string
  recipeEnv?: Record<string, string>
  stepTimeoutMs: number
  /**
   * Run-level cancellation (external abort or the overall run wall-clock). An
   * in-flight step child is SIGKILLed and the scenario settles as an `error`
   * WITHOUT writing evidence — the run discards these results anyway.
   */
  signal?: AbortSignal
  /**
   * Write the evidence transcript for a `pass` too (proof of what executed). A
   * fail/error always writes its bundle; this only gates the pass. Off for the
   * generator's birth validation, whose passing candidates leave no committed run
   * to anchor a transcript — the very next real run captures it (birth-time pass
   * evidence stays uncaptured, per the plan). Defaults on for a real run.
   */
  capturePassEvidence: boolean
}

/**
 * The two fixed `failure.expected` sentinels a scenario run emits when its declared
 * SETUP could not materialize BEFORE any step ran — a bad `setup.files` path (a
 * sandbox escape) or a `setup` capability that failed (e.g. `setup.git` naming an
 * unseeded file). Both are generation defects the model can fix from the `actual`
 * message, not infrastructure, so the guard generator routes them through the one
 * evidence-retry. Named constants (not inline literals) so the produce sites below
 * and the {@link isSetupDefectResult} consume site can never drift.
 */
export const SANDBOX_SETUP_EXPECTED = 'sandbox setup to succeed'
export const CAPABILITY_SETUP_EXPECTED = 'setup capabilities to materialize'

/**
 * True when an `error` outcome is a setup-declaration defect (a bad `setup.files`
 * path or a failed `setup` capability, per the sentinels above) rather than genuine
 * infrastructure (build/spawn/timeout/entry). The guard generator retries these
 * once with the failure message as evidence, exactly like a birth `fail`.
 */
export function isSetupDefectResult(result: GuardScenarioResult): boolean {
  if (result.outcome !== 'error') return false
  const expected = result.failure?.expected
  return expected === SANDBOX_SETUP_EXPECTED || expected === CAPABILITY_SETUP_EXPECTED
}

/**
 * Interpolate `${unique}` in a cli EXPECTATION — its matcher values AND its
 * `files` KEYS (the asserted paths) — the same surface the cli request side has
 * (the cli driver carries no `${var}` captures or fixtures), so a scenario can
 * assert on a resource it named with `${unique}` and the failure/evidence shows
 * the resolved token. The `files` key is a path the step created from an argv that
 * WAS interpolated; leaving the key verbatim would look for a literal `${unique}`
 * filename and report every such assertion as missing.
 */
function applyUniqueExpect(expect: GuardExpect, unique: string): GuardExpect {
  const u = (s: string): string => applyUnique(s, unique)
  const stream = <M extends { equals?: string; contains?: string; matches?: string }>(m: M): M => ({
    ...m,
    ...(m.equals !== undefined ? { equals: u(m.equals) } : {}),
    ...(m.contains !== undefined ? { contains: u(m.contains) } : {}),
    ...(m.matches !== undefined ? { matches: u(m.matches) } : {}),
  })
  const file = <M extends { equals?: string; contains?: string }>(m: M): M => ({
    ...m,
    ...(m.equals !== undefined ? { equals: u(m.equals) } : {}),
    ...(m.contains !== undefined ? { contains: u(m.contains) } : {}),
  })
  return {
    ...expect,
    ...(expect.stdout ? { stdout: stream(expect.stdout) } : {}),
    ...(expect.stderr ? { stderr: stream(expect.stderr) } : {}),
    ...(expect.files
      ? { files: Object.fromEntries(Object.entries(expect.files).map(([k, v]) => [u(k), file(v)])) }
      : {}),
  }
}

export async function runScenario(
  scenario: GuardCliScenario,
  ctx: RunScenarioContext,
): Promise<GuardScenarioResult> {
  const start = Date.now()
  // The result keys on the PRIMARY bind (the result schema carries one section);
  // evidence gets the full binding set. `flowId` groups the result under its flow.
  const base = {
    id: scenario.id,
    title: scenario.title,
    binds: scenario.binds[0],
    ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
  }
  const evidenceRefs = {
    binds: scenario.binds,
    ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
  }

  // The seeded world-state resolves its `${unique}` before anything materializes it,
  // so setup paths/content match the interpolated argv and expectations (see
  // {@link applyUniqueSetup}). The recipe-owned env stays verbatim.
  const setup = applyUniqueSetup(scenario.setup, ctx.unique)

  let sandbox
  try {
    sandbox = createSandbox({
      recipeEnv: ctx.recipeEnv,
      scenarioEnv: setup?.env,
      setupFiles: setup?.files,
    })
  } catch (e) {
    // Setup failure (e.g. a path escape) — infra error before any step ran.
    const message = e instanceof SandboxError ? e.message : e instanceof Error ? e.message : String(e)
    return {
      ...base,
      outcome: 'error',
      durationMs: Date.now() - start,
      failure: { step: 1, expected: SANDBOX_SETUP_EXPECTED, actual: message },
    }
  }

  const normCtx: NormalizerContext = { sandboxRoot: sandbox.root, repoRoot: ctx.repoRoot }
  const normText = (t: string): string => normalize(t, scenario.normalize, normCtx)
  const records: EvidenceStep[] = []

  try {
    // Materialize declared setup capabilities (git, …) after files seeding. A
    // provider failure is infrastructure — an `error` outcome naming the
    // capability, never a `fail`, mirroring how a build failure surfaces.
    try {
      applyCapabilities(setup, { cwd: sandbox.cwd, env: sandbox.env })
    } catch (e) {
      const message = e instanceof CapabilityError ? e.message : e instanceof Error ? e.message : String(e)
      return {
        ...base,
        outcome: 'error',
        durationMs: Date.now() - start,
        failure: { step: 1, expected: CAPABILITY_SETUP_EXPECTED, actual: message },
      }
    }

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]
      const stepIndex = i + 1
      // Substitute `${unique}` in the scenario-authored argv + stdin + env overlay
      // (the recipe-owned `resolvedEntry` is left verbatim). The cli driver has no
      // other `${var}` mechanism, so this is a surgical token replacement, not a
      // parser. Evidence records the RESOLVED overlay — what the child actually saw.
      const argv = [...ctx.resolvedEntry, ...step.run.map((a) => applyUnique(a, ctx.unique))]
      const stdin = step.stdin === undefined ? undefined : applyUnique(step.stdin, ctx.unique)
      const stepEnvOverlay = step.env ? applyUniqueEnv(step.env, ctx.unique) : undefined
      const repeat = step.repeat ?? 1
      // This step's env: the scenario sandbox env with the step's own overlay on
      // top, scoped to these child spawns only — the next step sees `sandbox.env`
      // again. `resolvedEntry` was pinned to an absolute interpreter at run start,
      // so a step PATH edit reaches CHILD lookups but never the entrypoint (item 7).
      const stepEnv = overlayStepEnv(sandbox.env, stepEnvOverlay)
      const invocation = {
        argv,
        stdin,
        ...(stepEnvOverlay ? { env: stepEnvOverlay } : {}),
        repeat,
      }

      let lastCapture: StepCapture | null = null
      for (let iteration = 1; iteration <= repeat; iteration++) {
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
        const capture = await executeStep({
          argv,
          cwd: sandbox.cwd,
          env: stepEnv,
          stdin,
          timeoutMs: ctx.stepTimeoutMs,
          signal: ctx.signal,
        })
        lastCapture = capture
        // A capture ended by cancellation is not a verdict — settle without evidence.
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)

        // Infrastructure problem — never a scenario fail.
        if (capture.spawnError || capture.timedOut) {
          const infra = capture.timedOut
            ? `step timed out after ${ctx.stepTimeoutMs}ms`
            : `failed to spawn: ${capture.spawnError}`
          records.push(toRecord({ index: stepIndex, ...invocation, iterationsRun: iteration }, capture, normText))
          const evidencePath = writeEvidence({
            repoRoot: ctx.repoRoot,
            runId: ctx.runId,
            scenarioId: scenario.id,
            title: scenario.title,
            ...evidenceRefs,
            outcome: 'error',
            steps: records,
            failingStep: stepIndex,
            infraMessage: infra,
            sandboxCwd: sandbox.cwd,
            envPins: ENV_PINS,
          })
          return {
            ...base,
            outcome: 'error',
            durationMs: Date.now() - start,
            ...(step.milestone ? { failedMilestone: step.milestone } : {}),
            failure: { step: stepIndex, expected: 'the step to run', actual: infra },
            evidencePath,
          }
        }

        const normStdout = normText(capture.stdout)
        const normStderr = normText(capture.stderr)
        const mismatch = evaluateExpect({
          expect: applyUniqueExpect(step.expect, ctx.unique),
          exitCode: capture.exitCode,
          stdout: normStdout,
          stderr: normStderr,
          sandboxCwd: sandbox.cwd,
          normalizeText: normText,
        })

        if (mismatch) {
          records.push(toRecord({ index: stepIndex, ...invocation, iterationsRun: iteration }, capture, normText))
          const evidencePath = writeEvidence({
            repoRoot: ctx.repoRoot,
            runId: ctx.runId,
            scenarioId: scenario.id,
            title: scenario.title,
            ...evidenceRefs,
            outcome: 'fail',
            steps: records,
            failingStep: stepIndex,
            mismatch,
            sandboxCwd: sandbox.cwd,
            envPins: ENV_PINS,
          })
          return {
            ...base,
            outcome: 'fail',
            durationMs: Date.now() - start,
            // The flow milestone that broke — absent when the step is plumbing.
            ...(step.milestone ? { failedMilestone: step.milestone } : {}),
            failure: {
              step: stepIndex,
              expected: mismatch.expected,
              actual: mismatch.actual,
              // The RAW child output that produced this mismatch (NOT the normalized
              // text matched against) — head-truncated, empty streams omitted.
              ...outputExcerpts(capture),
            },
            evidencePath,
          }
        }
      }

      if (lastCapture) {
        records.push(toRecord({ index: stepIndex, ...invocation, iterationsRun: repeat }, lastCapture, normText))
      }
    }

    // A pass earns the same evidence bundle as a fail/error: the transcript is the
    // proof of what executed, not a bare checkmark. No failing step to point at.
    // Skipped for birth validation, whose passing candidates have no run to anchor.
    const evidencePath = ctx.capturePassEvidence
      ? writeEvidence({
          repoRoot: ctx.repoRoot,
          runId: ctx.runId,
          scenarioId: scenario.id,
          title: scenario.title,
          ...evidenceRefs,
          outcome: 'pass',
          steps: records,
          sandboxCwd: sandbox.cwd,
          envPins: ENV_PINS,
        })
      : undefined
    return { ...base, outcome: 'pass', durationMs: Date.now() - start, ...(evidencePath ? { evidencePath } : {}) }
  } finally {
    sandbox.cleanup()
  }
}

/** The evidence-free `error` a cancelled scenario settles as (result is discarded). */
function abortedResult(
  base: Pick<GuardScenarioResult, 'id' | 'title' | 'binds' | 'flowId'>,
  step: number,
  start: number,
): GuardScenarioResult {
  return {
    ...base,
    outcome: 'error',
    durationMs: Date.now() - start,
    failure: { step, expected: 'the step to run', actual: 'run aborted' },
  }
}

function toRecord(
  invocation: Pick<EvidenceStep, 'index' | 'argv' | 'stdin' | 'env' | 'repeat' | 'iterationsRun'>,
  capture: StepCapture,
  normText: (t: string) => string,
): EvidenceStep {
  return {
    ...invocation,
    exitCode: capture.exitCode,
    timedOut: capture.timedOut,
    spawnError: capture.spawnError,
    rawStdout: capture.stdout,
    rawStderr: capture.stderr,
    normStdout: normText(capture.stdout),
    normStderr: normText(capture.stderr),
    durationMs: capture.durationMs,
  }
}
