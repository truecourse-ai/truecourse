/**
 * Run one scenario end-to-end in its own sandbox: seed → execute steps (stopping
 * at the first failing step) → map to a `GuardScenarioResult`. A spawn failure,
 * timeout, or setup escape is an `error` (infrastructure); an unmet expectation is
 * a `fail` (code-side drift candidate). Evidence is written for every EXECUTED
 * outcome — pass included (a green transcript is the proof of what ran) — but not
 * for a setup error that escaped before any step ran, which has nothing to transcribe.
 */

import type { GuardScenario, GuardScenarioResult } from '@truecourse/shared'
import { createSandbox, SandboxError, DETERMINISM_PINS } from './sandbox.js'
import { applyCapabilities, CapabilityError } from './capabilities/index.js'
import { executeStep, type StepCapture } from './executor.js'
import { normalize, type NormalizerContext } from './normalizers.js'
import { evaluateExpect } from './expect.js'
import { writeEvidence, type EvidenceStep } from './evidence.js'

// Evidence records the exact determinism pins the sandbox applied — one source,
// so what evidence claims can never drift from what the child actually saw.
const ENV_PINS = DETERMINISM_PINS

export interface RunScenarioContext {
  repoRoot: string
  runId: string
  resolvedEntry: string[]
  recipeEnv?: Record<string, string>
  stepTimeoutMs: number
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

export async function runScenario(
  scenario: GuardScenario,
  ctx: RunScenarioContext,
): Promise<GuardScenarioResult> {
  const start = Date.now()
  const base = {
    id: scenario.id,
    title: scenario.title,
    binds: scenario.binds,
  }

  let sandbox
  try {
    sandbox = createSandbox({
      recipeEnv: ctx.recipeEnv,
      scenarioEnv: scenario.setup?.env,
      setupFiles: scenario.setup?.files,
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
      applyCapabilities(scenario.setup, { cwd: sandbox.cwd, env: sandbox.env })
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
      const argv = [...ctx.resolvedEntry, ...step.run]
      const repeat = step.repeat ?? 1

      let lastCapture: StepCapture | null = null
      for (let iteration = 1; iteration <= repeat; iteration++) {
        const capture = await executeStep({
          argv,
          cwd: sandbox.cwd,
          env: sandbox.env,
          stdin: step.stdin,
          timeoutMs: ctx.stepTimeoutMs,
        })
        lastCapture = capture

        // Infrastructure problem — never a scenario fail.
        if (capture.spawnError || capture.timedOut) {
          const infra = capture.timedOut
            ? `step timed out after ${ctx.stepTimeoutMs}ms`
            : `failed to spawn: ${capture.spawnError}`
          records.push(toRecord(stepIndex, argv, step.stdin, repeat, iteration, capture, normText))
          const evidencePath = writeEvidence({
            repoRoot: ctx.repoRoot,
            runId: ctx.runId,
            scenarioId: scenario.id,
            title: scenario.title,
            binds: scenario.binds,
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
            failure: { step: stepIndex, expected: 'the step to run', actual: infra },
            evidencePath,
          }
        }

        const normStdout = normText(capture.stdout)
        const normStderr = normText(capture.stderr)
        const mismatch = evaluateExpect({
          expect: step.expect,
          exitCode: capture.exitCode,
          stdout: normStdout,
          stderr: normStderr,
          sandboxCwd: sandbox.cwd,
          normalizeText: normText,
        })

        if (mismatch) {
          records.push(toRecord(stepIndex, argv, step.stdin, repeat, iteration, capture, normText))
          const evidencePath = writeEvidence({
            repoRoot: ctx.repoRoot,
            runId: ctx.runId,
            scenarioId: scenario.id,
            title: scenario.title,
            binds: scenario.binds,
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
            failure: {
              step: stepIndex,
              expected: mismatch.expected,
              actual: mismatch.actual,
            },
            evidencePath,
          }
        }
      }

      if (lastCapture) {
        records.push(toRecord(stepIndex, argv, step.stdin, repeat, repeat, lastCapture, normText))
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
          binds: scenario.binds,
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

function toRecord(
  index: number,
  argv: string[],
  stdin: string | undefined,
  repeat: number,
  iterationsRun: number,
  capture: StepCapture,
  normText: (t: string) => string,
): EvidenceStep {
  return {
    index,
    argv,
    stdin,
    repeat,
    iterationsRun,
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
