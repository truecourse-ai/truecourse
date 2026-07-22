/**
 * Run one scenario end-to-end in its own sandbox: seed → execute steps (stopping
 * at the first failing step) → map to a `GuardScenarioResult`. A spawn failure,
 * timeout, or setup escape is an `error` (infrastructure); an unmet expectation is
 * a `fail` (code-side drift candidate). Evidence is written for every EXECUTED
 * outcome — pass included (a green transcript is the proof of what ran) — but not
 * for a setup error that escaped before any step ran, which has nothing to transcribe.
 *
 * An invariant scenario (`inputs.pack`, item 8) runs its steps ONCE PER FILE in the
 * referenced corpus pack — each iteration staging that file into the sandbox under a
 * stable name — so one rule is checked over many inputs. A failing sweep NAMES the
 * corpus file that broke the rule (that file is the repro), and one bad file fails
 * the whole scenario; a scenario whose pack is missing/empty fails LOUD (an orphaned
 * pack is never silently skipped). The steps gain two property forms: `stableOnRerun`
 * (the step reproduces its output on a second run — determinism / in-place
 * idempotence) and `stdinFromStep` (a step's stdin is an earlier step's stdout, so
 * "the output of step N must itself pass step M").
 */

import { DEFAULT_INPUT_NAME, type GuardScenario, type GuardScenarioResult, type OutputExcerpts } from '@truecourse/shared'
import fs from 'node:fs'
import path from 'node:path'
import { createSandbox, SandboxError, DETERMINISM_PINS, type Sandbox } from './sandbox.js'
import { applyCapabilities, CapabilityError } from './capabilities/index.js'
import { executeStep, type StepCapture } from './executor.js'
import { normalize, type NormalizerContext } from './normalizers.js'
import { evaluateExpect, type ExpectMismatch } from './expect.js'
import { loadPackInputs, type PackInput } from './store.js'
import { writeEvidence, type EvidenceStep } from './evidence.js'

// Evidence records the exact determinism pins the sandbox applied — one source,
// so what evidence claims can never drift from what the child actually saw.
const ENV_PINS = DETERMINISM_PINS

/**
 * A compact observation of ONE executed step invocation (each `repeat` iteration is
 * one, and a `stableOnRerun` re-run counts too), the raw-capture fields the runner
 * aggregates into per-run step stats for no-op anomaly detection. Emitted for every
 * step that SPAWNED (a spawn failure is not an executed step); a timed-out step
 * counts (it ran) but is never a no-op.
 */
export interface StepObservation {
  exitCode: number | null
  /** The raw stdout was empty (before normalization). */
  stdoutEmpty: boolean
  /** The raw stderr was empty (before normalization). */
  stderrEmpty: boolean
  durationMs: number
}

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
  /**
   * Fired once per executed step invocation (each `repeat` iteration counts) with a
   * compact capture observation. The runner aggregates these across the run into
   * step stats; nothing is persisted. A step that could not spawn is not reported.
   */
  onStep?: (observation: StepObservation) => void
  /**
   * Per-input progress for an invariant scenario (`inputs.pack`) — fired once per
   * corpus file as the sweep advances (counters idiom, no bars). Absent on an
   * ordinary scenario (a single run has nothing to tick).
   */
  onInput?: (done: number, total: number) => void
}

/** The observation the runner aggregates — raw emptiness + timing, no output kept. */
function observeStep(capture: StepCapture): StepObservation {
  return {
    exitCode: capture.exitCode,
    stdoutEmpty: capture.stdout.length === 0,
    stderrEmpty: capture.stderr.length === 0,
    durationMs: capture.durationMs,
  }
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
 * One staged corpus input for an invariant sweep: its pack-relative name (named in a
 * failure so the file is the repro) and the sandbox-relative path it stages to.
 */
interface StagedInput {
  name: string
  content: string
  /** The sandbox-relative path the file stages to (the scenario's `inputs.as`). */
  as: string
}

export async function runScenario(
  scenario: GuardScenario,
  ctx: RunScenarioContext,
): Promise<GuardScenarioResult> {
  const start = Date.now()
  const base = {
    id: scenario.id,
    title: scenario.title,
    ...(scenario.claim ? { claim: scenario.claim } : {}),
    binds: scenario.binds,
  }

  // Invariant scenario: sweep the corpus pack, one full steps run per file.
  if (scenario.inputs) {
    const loaded = loadPackInputs(ctx.repoRoot, scenario.inputs.pack)
    if (!loaded.ok) {
      // Orphaned pack — fail LOUD, never a silent skip.
      return {
        ...base,
        outcome: 'error',
        durationMs: Date.now() - start,
        failure: { step: 1, expected: 'the input pack to exist', actual: loaded.reason },
      }
    }
    return sweepInvariant(scenario, ctx, base, start, loaded.files, scenario.inputs.as ?? DEFAULT_INPUT_NAME)
  }

  return runSingle(scenario, ctx, base, start, null, ctx.capturePassEvidence)
}

/**
 * Run the scenario's steps once per corpus file. The steps run in a FRESH sandbox
 * per file (so one file's in-place edits never leak into the next), each staging that
 * file at `as` alongside `setup.files`. The first non-pass file settles the scenario —
 * its failure NAMES the file. All-pass settles pass, carrying the first file's
 * transcript (the representative proof of what ran).
 */
async function sweepInvariant(
  scenario: GuardScenario,
  ctx: RunScenarioContext,
  base: Pick<GuardScenarioResult, 'id' | 'title' | 'claim' | 'binds'>,
  start: number,
  files: PackInput[],
  as: string,
): Promise<GuardScenarioResult> {
  ctx.onInput?.(0, files.length)
  let firstPass: GuardScenarioResult | null = null
  for (let j = 0; j < files.length; j++) {
    if (ctx.signal?.aborted) return abortedResult(base, 1, start)
    const staged: StagedInput = { name: files[j].name, content: files[j].content, as }
    // Only the first file's pass earns a transcript (the whole sweep passed the same
    // way); a failing file always writes its own evidence, overwriting the dir.
    const result = await runSingle(scenario, ctx, base, start, staged, ctx.capturePassEvidence && j === 0)
    ctx.onInput?.(j + 1, files.length)
    if (result.outcome !== 'pass') return result
    firstPass ??= result
  }
  // Every file held the rule.
  return {
    ...base,
    outcome: 'pass',
    durationMs: Date.now() - start,
    ...(firstPass?.evidencePath ? { evidencePath: firstPass.evidencePath } : {}),
  }
}

/**
 * Run the scenario's steps once in one fresh sandbox, optionally with a corpus file
 * staged. Maps to a `GuardScenarioResult` and writes evidence exactly as a v1 run —
 * plus, for an invariant sweep, it NAMES the staged corpus file on any failure.
 */
async function runSingle(
  scenario: GuardScenario,
  ctx: RunScenarioContext,
  base: Pick<GuardScenarioResult, 'id' | 'title' | 'claim' | 'binds'>,
  start: number,
  staged: StagedInput | null,
  capturePassEvidence: boolean,
): Promise<GuardScenarioResult> {
  /** Annotate a failure detail with the staged corpus file, when this is a sweep. */
  const withInput = <T extends { actual: string }>(failure: T): T & { input?: string } =>
    staged ? { ...failure, actual: `[input: ${staged.name}] ${failure.actual}`, input: staged.name } : failure

  const setupFiles = staged
    ? { ...(scenario.setup?.files ?? {}), [staged.as]: staged.content }
    : scenario.setup?.files

  let sandbox: Sandbox
  try {
    sandbox = createSandbox({
      recipeEnv: ctx.recipeEnv,
      scenarioEnv: scenario.setup?.env,
      setupFiles,
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
  /** The last iteration's RAW stdout per 1-based step index — the source for `stdinFromStep`. */
  const priorStdout = new Map<number, string>()

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

      // Step-chaining: this step's stdin is an earlier step's captured stdout. A
      // forward/self/missing reference is an authoring defect — a loud infra error.
      let stdin = step.stdin
      if (step.stdinFromStep !== undefined) {
        if (step.stdinFromStep >= stepIndex || !priorStdout.has(step.stdinFromStep)) {
          const infra = `step ${stepIndex} references stdinFromStep ${step.stdinFromStep}, which is not an earlier executed step`
          records.push(toRecord(stepIndex, argv, stdin, step.repeat ?? 1, 0, emptyCapture(), normText))
          const evidencePath = writeEvidence(evidenceParams(scenario, ctx, 'error', records, sandbox.cwd, stepIndex, undefined, infra))
          return { ...base, outcome: 'error', durationMs: Date.now() - start, failure: withInput({ step: stepIndex, expected: 'a valid earlier step reference', actual: infra }), evidencePath }
        }
        stdin = priorStdout.get(step.stdinFromStep)
      }

      const repeat = step.repeat ?? 1

      let lastCapture: StepCapture | null = null
      for (let iteration = 1; iteration <= repeat; iteration++) {
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
        const capture = await executeStep({
          argv,
          cwd: sandbox.cwd,
          env: sandbox.env,
          stdin,
          timeoutMs: ctx.stepTimeoutMs,
          signal: ctx.signal,
        })
        lastCapture = capture
        // A capture ended by cancellation is not a verdict — settle without evidence.
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)

        // Aggregate every step that actually spawned (a spawn failure never ran).
        if (!capture.spawnError) ctx.onStep?.(observeStep(capture))

        // Infrastructure problem — never a scenario fail.
        if (capture.spawnError || capture.timedOut) {
          const infra = capture.timedOut
            ? `step timed out after ${ctx.stepTimeoutMs}ms`
            : `failed to spawn: ${capture.spawnError}`
          records.push(toRecord(stepIndex, argv, stdin, repeat, iteration, capture, normText))
          const evidencePath = writeEvidence(evidenceParams(scenario, ctx, 'error', records, sandbox.cwd, stepIndex, undefined, infra))
          return {
            ...base,
            outcome: 'error',
            durationMs: Date.now() - start,
            failure: withInput({ step: stepIndex, expected: 'the step to run', actual: infra }),
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
          records.push(toRecord(stepIndex, argv, stdin, repeat, iteration, capture, normText))
          const evidencePath = writeEvidence(evidenceParams(scenario, ctx, 'fail', records, sandbox.cwd, stepIndex, mismatch))
          return {
            ...base,
            outcome: 'fail',
            durationMs: Date.now() - start,
            failure: withInput({
              step: stepIndex,
              expected: mismatch.expected,
              actual: mismatch.actual,
              // The RAW child output that produced this mismatch (NOT the normalized
              // text matched against) — head-truncated, empty streams omitted.
              ...outputExcerpts(capture),
            }),
            evidencePath,
          }
        }
      }

      // Property form: the step must reproduce its output on a re-run (determinism /
      // in-place idempotence). Checked only after the step's own `expect` held.
      if (step.stableOnRerun && lastCapture && !ctx.signal?.aborted) {
        const stable = await checkStableOnRerun({
          ctx, argv, stdin, first: lastCapture,
          sandboxCwd: sandbox.cwd, sandboxEnv: sandbox.env, stagedAs: staged?.as ?? null, normText,
        })
        if (stable.aborted) return abortedResult(base, stepIndex, start)
        lastCapture = stable.capture
        if (stable.mismatch) {
          records.push(toRecord(stepIndex, argv, stdin, 2, 2, stable.capture, normText))
          const outcome = stable.infra ? 'error' : 'fail'
          const evidencePath = writeEvidence(
            outcome === 'fail'
              ? evidenceParams(scenario, ctx, 'fail', records, sandbox.cwd, stepIndex, stable.mismatch)
              : evidenceParams(scenario, ctx, 'error', records, sandbox.cwd, stepIndex, undefined, stable.mismatch.actual),
          )
          return {
            ...base,
            outcome,
            durationMs: Date.now() - start,
            failure: withInput({ step: stepIndex, expected: stable.mismatch.expected, actual: stable.mismatch.actual, ...outputExcerpts(stable.capture) }),
            evidencePath,
          }
        }
      }

      if (lastCapture) {
        priorStdout.set(stepIndex, lastCapture.stdout)
        records.push(toRecord(stepIndex, argv, stdin, repeat, repeat, lastCapture, normText))
      }
    }

    // A pass earns the same evidence bundle as a fail/error: the transcript is the
    // proof of what executed, not a bare checkmark. No failing step to point at.
    // Skipped for birth validation, whose passing candidates have no run to anchor.
    const evidencePath = capturePassEvidence
      ? writeEvidence(evidenceParams(scenario, ctx, 'pass', records, sandbox.cwd))
      : undefined
    return { ...base, outcome: 'pass', durationMs: Date.now() - start, ...(evidencePath ? { evidencePath } : {}) }
  } finally {
    sandbox.cleanup()
  }
}

/** Assemble the evidence-writer params from the run state (one call shape). */
function evidenceParams(
  scenario: GuardScenario,
  ctx: RunScenarioContext,
  outcome: 'pass' | 'fail' | 'error',
  steps: EvidenceStep[],
  sandboxCwd: string,
  failingStep?: number,
  mismatch?: ExpectMismatch,
  infraMessage?: string,
): Parameters<typeof writeEvidence>[0] {
  return {
    repoRoot: ctx.repoRoot,
    runId: ctx.runId,
    scenarioId: scenario.id,
    title: scenario.title,
    binds: scenario.binds,
    outcome,
    steps,
    ...(failingStep !== undefined ? { failingStep } : {}),
    ...(mismatch ? { mismatch } : {}),
    ...(infraMessage !== undefined ? { infraMessage } : {}),
    sandboxCwd,
    envPins: ENV_PINS,
  }
}

/** The outcome of a `stableOnRerun` check: the re-run capture (or the first capture
 *  when it could not re-run), plus a mismatch when the re-run diverged. `infra` marks
 *  a spawn/timeout error on the re-run (an `error`, not a `fail`). */
interface StabilityResult {
  capture: StepCapture
  mismatch: ExpectMismatch | null
  infra: boolean
  aborted: boolean
}

/**
 * Run the step a SECOND time and compare against the first run: same exit code, same
 * normalized stdout/stderr, and — when a corpus input is staged — the same input-file
 * content (in-place idempotence, the fixed point an idempotent fixer must reproduce).
 * Any divergence is a stability `fail`; a spawn failure / timeout on the re-run is an
 * infra error. The re-run's step is aggregated into the run's step stats like any
 * spawned step.
 */
async function checkStableOnRerun(a: {
  ctx: RunScenarioContext
  argv: string[]
  stdin: string | undefined
  first: StepCapture
  sandboxCwd: string
  sandboxEnv: NodeJS.ProcessEnv
  stagedAs: string | null
  normText: (t: string) => string
}): Promise<StabilityResult> {
  // Snapshot the staged input file after run 1 (the fixed point an in-place fixer
  // should reproduce). Normalized before comparison, like a file matcher.
  const fileAfter1 = a.stagedAs ? readStaged(a.sandboxCwd, a.stagedAs, a.normText) : null

  const capture = await executeStep({
    argv: a.argv,
    cwd: a.sandboxCwd,
    env: a.sandboxEnv,
    stdin: a.stdin,
    timeoutMs: a.ctx.stepTimeoutMs,
    signal: a.ctx.signal,
  })
  if (a.ctx.signal?.aborted) return { capture, mismatch: null, infra: false, aborted: true }
  if (!capture.spawnError) a.ctx.onStep?.(observeStep(capture))

  if (capture.spawnError || capture.timedOut) {
    const infra = capture.timedOut
      ? `step timed out after ${a.ctx.stepTimeoutMs}ms on the stability re-run`
      : `failed to spawn on the stability re-run: ${capture.spawnError}`
    return { capture, mismatch: stabilityMismatch('stderr', 'the re-run to execute', infra), infra: true, aborted: false }
  }

  const out1 = a.normText(a.first.stdout)
  const out2 = a.normText(capture.stdout)
  const err1 = a.normText(a.first.stderr)
  const err2 = a.normText(capture.stderr)
  const fileAfter2 = a.stagedAs ? readStaged(a.sandboxCwd, a.stagedAs, a.normText) : null

  if (a.first.exitCode !== capture.exitCode) {
    return { capture, mismatch: stabilityMismatch('exit', 'identical exit code on re-run', `exit ${a.first.exitCode ?? '(none)'} then ${capture.exitCode ?? '(none)'}`), infra: false, aborted: false }
  }
  if (out1 !== out2) {
    return { capture, mismatch: stabilityStreamMismatch('stdout', out1, out2), infra: false, aborted: false }
  }
  if (err1 !== err2) {
    return { capture, mismatch: stabilityStreamMismatch('stderr', err1, err2), infra: false, aborted: false }
  }
  if (fileAfter1 !== null && fileAfter2 !== null && fileAfter1 !== fileAfter2) {
    return {
      capture,
      mismatch: {
        subject: 'files',
        expected: `${a.stagedAs} unchanged by the re-run (idempotent)`,
        actual: `${a.stagedAs} changed on the second run`,
        detail: [`--- ${a.stagedAs} after run 1 ---`, fileAfter1, `--- ${a.stagedAs} after run 2 ---`, fileAfter2],
      },
      infra: false,
      aborted: false,
    }
  }
  return { capture, mismatch: null, infra: false, aborted: false }
}

/** A stability mismatch on a stream — the two runs' (normalized) outputs differed. */
function stabilityStreamMismatch(subject: 'stdout' | 'stderr', v1: string, v2: string): ExpectMismatch {
  return {
    subject,
    expected: `identical ${subject} on re-run`,
    actual: `${subject} differed between the two runs`,
    detail: [`--- ${subject} run 1 ---`, v1, `--- ${subject} run 2 ---`, v2],
  }
}

/** A one-line stability mismatch (exit code / infra) with no two-value diff body. */
function stabilityMismatch(subject: ExpectMismatch['subject'], expected: string, actual: string): ExpectMismatch {
  return { subject, expected, actual, detail: [actual] }
}

/** Read a staged sandbox file (normalized), or null when it does not exist. */
function readStaged(cwd: string, rel: string, normText: (t: string) => string): string | null {
  const target = path.resolve(cwd, rel)
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null
  return normText(fs.readFileSync(target, 'utf-8'))
}

/** A zero-value capture for a step that never spawned (an authoring-defect record). */
function emptyCapture(): StepCapture {
  return { exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, durationMs: 0 }
}

/** The evidence-free `error` a cancelled scenario settles as (result is discarded). */
function abortedResult(
  base: Pick<GuardScenarioResult, 'id' | 'title' | 'binds'>,
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
