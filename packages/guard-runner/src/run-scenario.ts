/**
 * Run one scenario end-to-end in its own sandbox: seed → execute steps (stopping
 * at the first failing step) → map to a `GuardScenarioResult`. A spawn failure,
 * timeout, or setup escape is an `error` (infrastructure); an unmet expectation is
 * a `fail` (code-side drift candidate). Evidence is written for every EXECUTED
 * outcome — pass included (a green transcript is the proof of what ran) — but not
 * for a setup error that escaped before any step ran, which has nothing to transcribe.
 *
 * Beyond `run` steps, a scenario may drive ONE managed SERVICE — a long-running
 * command started by a `boot` step (readiness asserted on a stdout/stderr line,
 * never on exit), signalled by `signal` steps, observed by `logs` steps — the cli
 * analog of the api driver's server-process lifecycle, on the same spawn shape
 * (`service-process.ts`). At most one service runs at a time (a second `boot`
 * replaces the first), and the service is killed at scenario end no matter how
 * the scenario exits.
 */

import type {
  GuardCliBootStep,
  GuardCliLogsStep,
  GuardCliScenario,
  GuardCliSignalStep,
  GuardExpect,
  GuardScenarioResult,
  OutputExcerpts,
} from '@truecourse/shared'
import {
  blockedPreconditionAnnotation,
  describeCliLifecycleStep,
  isCliBootStep,
  isCliRunStep,
  isCliSignalStep,
} from '@truecourse/shared'
import { createSandbox, SandboxError, DETERMINISM_PINS } from './sandbox.js'
import { overlayStepEnv } from './child-env.js'
import { applyCapabilities, CapabilityError } from './capabilities/index.js'
import { startHttpStubs, applyHttpStubOrigins, type HttpStubsHandle } from './capabilities/http.js'
import { startExternalProxies } from './capabilities/external-proxy.js'
import { executeStep, type StepCapture } from './executor.js'
import {
  spawnServiceProcess,
  matchingLogLines,
  logMatchLabel,
  exitLabel,
  SIGNAL_EXIT_TIMEOUT_MS,
  LOGS_WAIT_MS,
  LOGS_POLL_INTERVAL_MS,
  type ServiceProcessHandle,
} from './service-process.js'
import type { StepObservation } from './step-stats.js'
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
  /**
   * Fired once per executed step invocation (each `repeat` iteration counts) with
   * a compact capture observation. The runner aggregates these across the run
   * into the no-op anomaly stats (C4); nothing is persisted. A step that could
   * not spawn is not reported.
   */
  onStep?: (observation: StepObservation) => void
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
 * The infra reason for a step whose output outlived it (`orphanedStdio`) — the
 * command returned but something it started still holds the pipes, so what the
 * step printed is only what had arrived when the run gave up waiting.
 */
export const ORPHANED_STDIO_INFRA =
  'the step left a background process still holding its output (a spawned daemon?)'

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

/** The captured output of every service process one scenario ran, in boot order. */
interface ServiceLogs {
  stdout: string
  stderr: string
}

/** A position in each captured stream — the base of a `sinceLastStep` window. */
interface LogMark {
  stdout: number
  stderr: number
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
  const declaredSetup = applyUniqueSetup(scenario.setup, ctx.unique)

  // The `http` capability comes up FIRST — before the sandbox env is built — because
  // the stub origins are substituted into `setup.env`, which is what the program under
  // test reads its stubbed dependency's base URL from. A stub that cannot listen (or a
  // `${HTTP_STUB:…}` naming an undeclared stub) is infrastructure, not a finding.
  let stubs: HttpStubsHandle | null = null
  let setup = declaredSetup
  try {
    stubs = await startHttpStubs(declaredSetup?.http)
    if (stubs) setup = applyHttpStubOrigins(declaredSetup, stubs.origins)
    // External accounts configure the API SERVER's env, so the cli
    // driver never proxies one. A cli scenario that scripts `setup.externals` is
    // therefore addressing a world that does not exist here — the same loud
    // CapabilityError an undeclared stub reference earns, never a silent no-op.
    await startExternalProxies({ targets: [], scripts: declaredSetup?.externals })
  } catch (e) {
    await stubs?.stop()
    const message = e instanceof CapabilityError ? e.message : e instanceof Error ? e.message : String(e)
    return {
      ...base,
      outcome: 'error',
      durationMs: Date.now() - start,
      failure: { step: 1, expected: CAPABILITY_SETUP_EXPECTED, actual: message },
    }
  }

  let sandbox
  try {
    sandbox = createSandbox({
      recipeEnv: ctx.recipeEnv,
      scenarioEnv: setup?.env,
      setupFiles: setup?.files,
    })
  } catch (e) {
    // Setup failure (e.g. a path escape) — infra error before any step ran.
    await stubs?.stop()
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

  // The managed SERVICE — at most one runs at a time; a `boot` replaces it, and the
  // `finally` below kills whatever is left however the scenario exits. Its output is
  // ACCUMULATED across boots (the api driver's rule), so a restart's earlier lines
  // stay readable and in evidence after the second boot replaced the handle.
  let service: ServiceProcessHandle | null = null
  const retired: ServiceLogs = { stdout: '', stderr: '' }
  /** Everything every service of this scenario has written so far. */
  const serviceLogs = (): ServiceLogs => {
    const live = service?.logs() ?? { stdout: '', stderr: '' }
    return { stdout: retired.stdout + live.stdout, stderr: retired.stderr + live.stderr }
  }
  /** The same accumulator, read AFTER the live service's stdio flush barrier — the
   *  only form a verdict, excerpt or evidence bundle may be built from. */
  const settledLogs = async (): Promise<ServiceLogs> => {
    await service?.drain()
    return serviceLogs()
  }
  /** Stop the running service (if any) and fold its output into the accumulator. */
  const retireService = async (): Promise<void> => {
    if (!service) return
    await service.stop()
    await service.drain()
    const last = service.logs()
    retired.stdout += last.stdout
    retired.stderr += last.stderr
    service = null
  }
  /** True once ANY service process of this scenario has been spawned. */
  let everBooted = false
  /** Settled log lengths as of the START of the previous step — a `logs` window's base. */
  let previousStepMark: LogMark = { stdout: 0, stderr: 0 }
  /** The service's output for an evidence bundle — absent until a boot happened. */
  const evidenceServiceLogs = async (): Promise<{ serviceLogs?: ServiceLogs }> =>
    everBooted ? { serviceLogs: await settledLogs() } : {}

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

    /** An `error` outcome for a lifecycle step — infrastructure, never a verdict. */
    const errorAt = (
      stepIndex: number,
      milestone: number | undefined,
      expected: string,
      actual: string,
    ): GuardScenarioResult => ({
      ...base,
      outcome: 'error',
      durationMs: Date.now() - start,
      ...(milestone ? { failedMilestone: milestone } : {}),
      failure: { step: stepIndex, expected, actual },
    })

    /** A lifecycle step's `fail`, with its evidence bundle (mirrors the api driver). */
    const lifecycleFail = async (
      step: GuardCliBootStep | GuardCliSignalStep | GuardCliLogsStep,
      stepIndex: number,
      expected: string,
      actual: string,
      detail?: string[],
    ): Promise<GuardScenarioResult> => {
      records.push(lifecycleRecord(stepIndex, step))
      const evidencePath = writeEvidence({
        repoRoot: ctx.repoRoot,
        runId: ctx.runId,
        scenarioId: scenario.id,
        title: scenario.title,
        ...evidenceRefs,
        outcome: 'fail',
        steps: records,
        failingStep: stepIndex,
        mismatch: {
          subject: 'process',
          expected,
          actual,
          detail: detail ?? [`expected: ${expected}`, `actual:   ${actual}`],
        },
        sandboxCwd: sandbox.cwd,
        envPins: ENV_PINS,
        ...(await evidenceServiceLogs()),
      })
      return {
        ...base,
        outcome: 'fail',
        durationMs: Date.now() - start,
        ...(step.milestone ? { failedMilestone: step.milestone } : {}),
        ...blockedPreconditionAnnotation(scenario.steps, stepIndex),
        failure: { step: stepIndex, expected, actual },
        evidencePath,
      }
    }

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]
      const stepIndex = i + 1
      // Attribute any stub violation raised while this step runs to THIS step.
      stubs?.markStep(stepIndex)
      // Taken BEFORE the step runs, and handed to the NEXT step: a `logs` step's
      // `sinceLastStep` window is everything that arrived after the step before it
      // began. Read through the flush barrier ({@link ServiceProcessHandle.drain}),
      // so every byte the service had handed to the OS before this step settles on
      // the EARLIER side of the boundary.
      await service?.drain()
      const atMark = serviceLogs()
      const markAtStart: LogMark = { stdout: atMark.stdout.length, stderr: atMark.stderr.length }

      // --- The service-lifecycle steps -------------------------------------
      if (!isCliRunStep(step)) {
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)

        if (isCliBootStep(step)) {
          // A boot always replaces whatever is running — its output is folded into
          // the scenario's accumulator first, so nothing a restart printed is lost.
          await retireService()
          const argv = [...ctx.resolvedEntry, ...step.boot.run.map((a) => applyUnique(a, ctx.unique))]
          const bootEnv = overlayStepEnv(
            sandbox.env,
            step.boot.env ? applyUniqueEnv(step.boot.env, ctx.unique) : undefined,
          )
          let spawned
          try {
            spawned = spawnServiceProcess({ argv, cwd: sandbox.cwd, env: bootEnv })
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            return errorAt(stepIndex, step.milestone, 'the service to start', `failed to spawn: ${message}`)
          }
          service = spawned.handle
          everBooted = true

          // Readiness: poll THIS boot's captured output for the declared line. The
          // budget is the step timeout unless the step narrows it. A readiness that
          // never appears is a FAIL (the api driver's unhealthy-boot rule — the
          // process existed and was judged), never an error; only a child that could
          // not be spawned at all is infrastructure.
          const { stream, match } = step.boot.ready
          const budget = step.boot.ready.withinMs ?? ctx.stepTimeoutMs
          const deadline = Date.now() + budget
          let ready = false
          for (;;) {
            if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
            await service.drain()
            if (matchingLogLines(service.logs()[stream], match).length > 0) {
              ready = true
              break
            }
            const exit = service.exit()
            if (exit?.exited) {
              const spawnError = spawned.spawnError()
              const bootLogs = service.logs()
              await retireService()
              if (spawnError) {
                return errorAt(stepIndex, step.milestone, 'the service to start', `failed to spawn: ${spawnError}`)
              }
              return lifecycleFail(
                step,
                stepIndex,
                `the service to keep running and print a ${stream} line matching ${logMatchLabel(match)}`,
                `it ${exitLabel(exit)} before the readiness line appeared`,
                [`--- stdout ---`, bootLogs.stdout.slice(-FAILURE_OUTPUT_LIMIT), `--- stderr ---`, bootLogs.stderr.slice(-FAILURE_OUTPUT_LIMIT)],
              )
            }
            if (Date.now() > deadline) break
            await new Promise((r) => setTimeout(r, LOGS_POLL_INTERVAL_MS))
          }
          if (!ready) {
            // The service came up but never said so — it must not outlive the failed boot.
            const window = (await settledLogs())[stream].slice(markAtStart[stream])
            await retireService()
            return lifecycleFail(
              step,
              stepIndex,
              `a ${stream} line matching ${logMatchLabel(match)} within ${budget}ms of the service starting`,
              'the service produced no such line',
              [`--- ${stream} ---`, window.slice(-FAILURE_OUTPUT_LIMIT)],
            )
          }
          records.push(lifecycleRecord(stepIndex, step))
          previousStepMark = markAtStart
          continue
        }

        if (isCliSignalStep(step)) {
          if (!service) {
            return errorAt(
              stepIndex,
              step.milestone,
              'a running service to signal',
              'no service is running — a `boot` step must start one before it can be signalled',
            )
          }
          service.signal(step.signal.name)
          const expectation = step.signal.expect
          if (expectation) {
            const budget = expectation.withinMs ?? SIGNAL_EXIT_TIMEOUT_MS
            const exit = await service.waitForExit(budget)
            if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
            if (!exit.exited) {
              await retireService()
              return lifecycleFail(
                step,
                stepIndex,
                `the service to exit within ${budget}ms of ${step.signal.name}`,
                'it was still running at the deadline',
              )
            }
            if (expectation.exitCode !== undefined && exit.code !== expectation.exitCode) {
              const detail = [`--- stderr ---`, (await settledLogs()).stderr.slice(-FAILURE_OUTPUT_LIMIT)]
              await retireService()
              return lifecycleFail(
                step,
                stepIndex,
                `the service to exit with code ${expectation.exitCode} on ${step.signal.name}`,
                `it ${exitLabel(exit)}`,
                detail,
              )
            }
          }
          // A dead process is retired immediately, so a later step sees "no service
          // running" rather than a handle onto a corpse.
          if (service.exit()) await retireService()
          records.push(lifecycleRecord(stepIndex, step))
          previousStepMark = markAtStart
          continue
        }

        // `logs` — assert on what the service process wrote.
        if (!everBooted) {
          return errorAt(
            stepIndex,
            step.milestone,
            'a service whose output can be read',
            'no service has been started yet — a `boot` step must precede a `logs` step',
          )
        }
        const { stream, match } = step.logs
        const from = step.logs.sinceLastStep ? previousStepMark[stream] : 0
        const want = step.logs.count ?? 1
        const deadline = Date.now() + (step.logs.withinMs ?? LOGS_WAIT_MS)
        // Every read of the window goes through the flush barrier, so a line the
        // service already wrote is judged on this attempt rather than costing a poll
        // interval — and the verdict is never taken on a half-read stream.
        const readWindow = async (): Promise<string> => (await settledLogs())[stream].slice(from)
        let window = await readWindow()
        let matches = matchingLogLines(window, match)
        while (matches.length < want && Date.now() < deadline) {
          if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
          await new Promise((r) => setTimeout(r, LOGS_POLL_INTERVAL_MS))
          window = await readWindow()
          matches = matchingLogLines(window, match)
        }
        const satisfied = step.logs.count === undefined ? matches.length >= 1 : matches.length === step.logs.count
        if (!satisfied) {
          const scope = step.logs.sinceLastStep ? ' since the previous step' : ''
          return lifecycleFail(
            step,
            stepIndex,
            step.logs.count === undefined
              ? `a ${stream} line matching ${logMatchLabel(match)}${scope}`
              : `exactly ${step.logs.count} ${stream} line(s) matching ${logMatchLabel(match)}${scope}`,
            `${matches.length} line(s) matched`,
            [`--- ${stream}${scope} ---`, window.slice(-FAILURE_OUTPUT_LIMIT)],
          )
        }
        records.push(lifecycleRecord(stepIndex, step))
        previousStepMark = markAtStart
        continue
      }

      // --- A run step -------------------------------------------------------
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
      // so a step PATH edit reaches CHILD lookups but never the entrypoint.
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
        // Aggregate every step that actually spawned (a spawn failure never ran).
        if (!capture.spawnError) ctx.onStep?.(observeStep(capture))
        // A capture ended by cancellation is not a verdict — settle without evidence.
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)

        // Infrastructure problem — never a scenario fail.
        if (capture.spawnError || capture.timedOut || capture.orphanedStdio) {
          // `timedOut` and `orphanedStdio` are mutually exclusive by construction
          // (see StepCapture): the command either overran the budget or finished
          // and left its stdio held. One reason each, never both.
          const infra = capture.spawnError
            ? `failed to spawn: ${capture.spawnError}`
            : capture.timedOut
              ? `step timed out after ${ctx.stepTimeoutMs}ms`
              : ORPHANED_STDIO_INFRA
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
            ...(await evidenceServiceLogs()),
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
            ...(await evidenceServiceLogs()),
          })
          return {
            ...base,
            outcome: 'fail',
            durationMs: Date.now() - start,
            // The flow milestone that broke — absent when the step is plumbing.
            ...(step.milestone ? { failedMilestone: step.milestone } : {}),
            // Plumbing that broke in a MILESTONED scenario is a blocked precondition
            // (a setup step asserting nothing about the spec), not doc-vs-code drift.
            // An annotation only — the outcome stays `fail`.
            ...blockedPreconditionAnnotation(scenario.steps, stepIndex),
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
      previousStepMark = markAtStart
    }

    // Every step met its expectations — but the scenario passes only if its stubs also
    // saw exactly what was declared. An unscripted third-party call, a violated request
    // assertion, or a wrong call count is a FINDING about the program-vs-third-party
    // contract, so it settles as a `fail` on the step it happened during (the `calls`
    // check has no step — it is attributed to the last one). The cli driver resolves no
    // credentials, so there is nothing to redact out of the recorded excerpts.
    const violation = stubs?.settle() ?? null
    if (violation) {
      const violationStep = violation.step ?? scenario.steps.length
      const evidencePath = writeEvidence({
        repoRoot: ctx.repoRoot,
        runId: ctx.runId,
        scenarioId: scenario.id,
        title: scenario.title,
        ...evidenceRefs,
        outcome: 'fail',
        steps: records,
        failingStep: violationStep,
        mismatch: {
          subject: 'stub',
          expected: violation.expected,
          actual: violation.actual,
          detail: violation.detail,
        },
        sandboxCwd: sandbox.cwd,
        envPins: ENV_PINS,
        ...(await evidenceServiceLogs()),
      })
      const milestone = scenario.steps[violationStep - 1]?.milestone
      return {
        ...base,
        outcome: 'fail',
        durationMs: Date.now() - start,
        ...(milestone ? { failedMilestone: milestone } : {}),
        ...blockedPreconditionAnnotation(scenario.steps, violationStep),
        failure: { step: violationStep, expected: violation.expected, actual: violation.actual },
        evidencePath,
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
          ...(await evidenceServiceLogs()),
        })
      : undefined
    return { ...base, outcome: 'pass', durationMs: Date.now() - start, ...(evidencePath ? { evidencePath } : {}) }
  } finally {
    // The service must not outlive the scenario, however it ended (pass, fail,
    // error, throw): SIGKILL the whole process group.
    await service?.stop()
    await stubs?.stop()
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

/**
 * A lifecycle step's evidence row: what it did and what it asserted, in the SAME
 * words the dashboard's step list uses ({@link describeCliLifecycleStep}), so the
 * transcript and the UI can never describe one step two ways.
 */
function lifecycleRecord(
  index: number,
  step: GuardCliBootStep | GuardCliSignalStep | GuardCliLogsStep,
): EvidenceStep {
  const described = describeCliLifecycleStep(step)
  const env = described.env ? ` (env: ${described.env.join(' ')})` : ''
  return {
    index,
    kind: isCliBootStep(step) ? 'boot' : isCliSignalStep(step) ? 'signal' : 'logs',
    action: `${described.command}${env}`,
    ...(described.expectation ? { expectation: described.expectation } : {}),
    repeat: 1,
    iterationsRun: 1,
    exitCode: null,
    timedOut: false,
    rawStdout: '',
    rawStderr: '',
    normStdout: '',
    normStderr: '',
    durationMs: 0,
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
