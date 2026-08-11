/**
 * Run one scenario end-to-end in its own sandbox: seed → execute steps (stopping
 * at the first failing step) → map to a `GuardScenarioResult`. A spawn failure,
 * timeout, or setup escape is an `error` (infrastructure); an unmet expectation is
 * a `fail` (code-side drift candidate). Evidence is written for every EXECUTED
 * outcome — pass included (a green transcript is the proof of what ran) — but not
 * for a setup error that escaped before any step ran, which has nothing to transcribe.
 */

import type {
  GuardCliScenario,
  GuardExpect,
  GuardFileExpect,
  GuardScenarioResult,
} from '@truecourse/shared'
import { blockedPreconditionAnnotation, milestoneOrder } from '@truecourse/shared'
import { createSandbox, SandboxError, DETERMINISM_PINS } from './sandbox.js'
import { applyCapabilities, CapabilityError } from './capabilities/index.js'
import {
  applySandbox,
  applySandboxEnv,
  applySandboxExpect,
  applySandboxSetup,
  mapExpectStrings,
} from './sandbox-token.js'
import { applyCaptured, applyCapturedEnv, CapturedValueError } from './captured.js'
import { applySupplied, applySuppliedExpect, type SuppliedInstance } from './dependencies.js'
import { startHttpStubs, applyHttpStubOrigins, type HttpStubsHandle } from './capabilities/http.js'
import { startExternalProxies } from './capabilities/external-proxy.js'
import type { StepObservation } from './step-stats.js'
import { normalize, type NormalizerContext } from './normalizers.js'
import { applyUnique, applyUniqueEnv, applyUniqueSetup } from './unique.js'
import { writeEvidence, type EvidenceStep } from './evidence.js'
import type { ExpectMismatch } from './expect.js'
import {
  buildStepDrivers,
  closeStepDrivers,
  driverFor,
  SANDBOX_SETUP_EXPECTED,
  type StepDriver,
} from './drivers/index.js'
import type { ResolvedWebSurface } from './recipe.js'
import { evidenceScenarioDir } from './store.js'

// Evidence records the exact determinism pins the sandbox applied — one source,
// so what evidence claims can never drift from what the child actually saw.
const ENV_PINS = DETERMINISM_PINS


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
  /** The recipe's `expose` map — programs put on the sandbox PATH under their name. */
  expose?: Record<string, string | string[]>
  /**
   * The PROVIDED supplied instances this scenario binds, copied into its sandbox
   * before anything runs. Only ever non-empty when every binding resolved: a
   * scenario with an unprovided one settles `blocked` in the run planner and never
   * reaches here.
   */
  supplied?: readonly SuppliedInstance[]
  stepTimeoutMs: number
  /**
   * The recipe's WEB SURFACE, when it declares one — how the served app starts and
   * how its readiness is observed. Present ⇒ a web step may open the browser
   * against it; absent ⇒ a scenario carrying web steps settles `error` naming the
   * missing `web` block, because a browser with nothing to point at is not a test.
   */
  web?: ResolvedWebSurface
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

/**
 * The `failure.expected` sentinel a scenario emits when a declared SETUP CAPABILITY
 * could not materialize before any step ran (`setup.git` naming an unseeded file).
 * A generation defect the model can fix from the `actual` message, not
 * infrastructure, so the guard generator routes it through the one evidence-retry.
 * Its sibling — a `setup.files` path escaping the sandbox — is the cli driver's
 * {@link SANDBOX_SETUP_EXPECTED}, re-exported below so both read from one source.
 */
export const CAPABILITY_SETUP_EXPECTED = 'setup capabilities to materialize'

// The sentinels a caller matches on, re-exported from where they are produced.
export { SANDBOX_SETUP_EXPECTED, ORPHANED_STDIO_INFRA } from './drivers/cli-driver.js'
export { NO_WEB_SURFACE_INFRA } from './drivers/web-driver.js'

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
 * `files` KEYS (the asserted paths), through the one traversal every token pass
 * shares — so a scenario can assert on a resource it named with `${unique}` and the
 * failure/evidence shows the resolved token. The `files` key is a path the step
 * created from an argv that WAS interpolated; leaving the key verbatim would look
 * for a literal `${unique}` filename and report every such assertion as missing.
 */
function applyUniqueExpect<E extends GuardExpect | GuardFileExpect>(expect: E, unique: string): E {
  return mapExpectStrings(expect, (text) => applyUnique(text, unique))
}

/** {@link applyCaptured} across a cli expectation — matcher values and `files` keys. */
function applyCapturedExpect<E extends GuardExpect | GuardFileExpect>(
  expect: E,
  values: ReadonlyMap<string, string>,
): E {
  return mapExpectStrings(expect, (text) => applyCaptured(text, values))
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
      repoRoot: ctx.repoRoot,
      ...(ctx.expose ? { expose: ctx.expose } : {}),
      ...(ctx.supplied ? { supplied: ctx.supplied } : {}),
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
  /** The step currently executing — what a `${captured:…}` miss is attributed to. */
  let stepInFlight = 1

  /** Where a driver's non-text artifacts land (a screenshot, a session video). */
  const evidenceDir = evidenceScenarioDir(ctx.repoRoot, ctx.runId, scenario.id)

  // THE DRIVERS this scenario runs with — built once, closed once. Each owns the
  // steps it declares and whatever it has to open to take them (the web driver's
  // served surface and browser open at its FIRST step and not before, because the
  // surface serves the sandbox that the cli steps ahead of it populate).
  const drivers: StepDriver[] = buildStepDrivers({
    resolvedEntry: ctx.resolvedEntry,
    ...(setup?.git?.identity ? { gitIdentity: setup.git.identity } : {}),
    surface: ctx.web ?? null,
  })

  try {
    // Materialize declared setup capabilities (git, …) after files seeding. A
    // provider failure is infrastructure — an `error` outcome naming the
    // capability, never a `fail`, mirroring how a build failure surfaces.
    try {
      applyCapabilities(applySandboxSetup(setup, sandbox.cwd), { cwd: sandbox.cwd, env: sandbox.env })
    } catch (e) {
      const message = e instanceof CapabilityError ? e.message : e instanceof Error ? e.message : String(e)
      return {
        ...base,
        outcome: 'error',
        durationMs: Date.now() - start,
        failure: { step: 1, expected: CAPABILITY_SETUP_EXPECTED, actual: message },
      }
    }

    // `${unique}`, `${supplied:…}`, `${sandbox}`, `${captured:…}` — the four tokens
    // a scenario-authored string may carry, resolved with the same surgical
    // substring replacement (never a parser) that `unique.ts` documents. The
    // recipe-owned `resolvedEntry` is never touched.
    //
    // `${captured:…}` resolves LAST, and deliberately: its value is the only one
    // that came from the PROGRAM rather than from the scenario, so substituting it
    // after the others means it is inserted and never re-scanned — a command that
    // prints `${sandbox}` cannot make the next step's argv expand it.
    /** What each step captured, in scenario order — read live by `tok` below. */
    const captured = new Map<string, string>()
    const tok = (text: string): string =>
      applyCaptured(
        applySandbox(applySupplied(applyUnique(text, ctx.unique), sandbox.supplied), sandbox.cwd),
        captured,
      )
    const resolveExpect = <E extends GuardExpect | GuardFileExpect>(expect: E): E =>
      applyCapturedExpect(
        applySandboxExpect(
          applySuppliedExpect(applyUniqueExpect(expect, ctx.unique), sandbox.supplied),
          sandbox.cwd,
        ),
        captured,
      )
    /** The same four passes across an env overlay's VALUES (the names are literal). */
    const resolveEnv = (env: Record<string, string>): Record<string, string> =>
      applyCapturedEnv(applySandboxEnv(applyUniqueEnv(env, ctx.unique), sandbox.cwd), captured)

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]
      const stepIndex = i + 1
      stepInFlight = stepIndex
      const stepMilestone = milestoneOrder(step.milestone)
      // Attribute any stub violation raised while this step runs to THIS step.
      stubs?.markStep(stepIndex)

      if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)

      // THE DISPATCH, and the only thing this loop knows about surfaces: the step
      // says how it acts, the registry says who takes it. What comes back is the
      // shared outcome vocabulary, so everything below is about the SCENARIO —
      // evidence, milestone attribution, the verdict — and nothing below branches
      // on what kind of step it was.
      const outcome = await driverFor(step, drivers).execute(step, {
        stepIndex,
        sandbox,
        repoRoot: ctx.repoRoot,
        runId: ctx.runId,
        scenarioId: scenario.id,
        evidenceDir,
        tok,
        resolveExpect,
        resolveEnv,
        normText,
        publishCaptures: (values) => {
          for (const [name, value] of Object.entries(values)) captured.set(name, value)
        },
        stepTimeoutMs: ctx.stepTimeoutMs,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        ...(ctx.onStep ? { onStep: ctx.onStep } : {}),
      })
      if (ctx.signal?.aborted || outcome.status === 'aborted') {
        return abortedResult(base, stepIndex, start)
      }
      records.push(...outcome.records)
      if (outcome.status === 'ok') continue

      // A step that could not be taken BEFORE it produced any record has nothing to
      // transcribe (a `cwd` that escapes the sandbox is the case): it settles like a
      // setup escape, with no bundle, exactly as it always has.
      const writable = outcome.records.length > 0 || records.length > 0
      const evidencePath =
        writable && outcome.status === 'error' && outcome.expected === SANDBOX_SETUP_EXPECTED
          ? undefined
          : writeEvidence({
              repoRoot: ctx.repoRoot,
              runId: ctx.runId,
              scenarioId: scenario.id,
              title: scenario.title,
              ...evidenceRefs,
              outcome: outcome.status,
              steps: records,
              failingStep: stepIndex,
              ...(outcome.status === 'fail'
                ? { mismatch: outcome.mismatch }
                : { infraMessage: outcome.message }),
              sandboxCwd: sandbox.cwd,
              envPins: ENV_PINS,
            })

      if (outcome.status === 'error') {
        return {
          ...base,
          outcome: 'error',
          durationMs: Date.now() - start,
          ...(stepMilestone ? { failedMilestone: stepMilestone } : {}),
          failure: { step: stepIndex, expected: outcome.expected, actual: outcome.message },
          ...(evidencePath ? { evidencePath } : {}),
        }
      }
      return {
        ...base,
        outcome: 'fail',
        durationMs: Date.now() - start,
        // The flow milestone that broke — absent when the step is plumbing.
        ...(stepMilestone ? { failedMilestone: stepMilestone } : {}),
        // Plumbing that broke in a MILESTONED scenario is a blocked precondition (a
        // setup step asserting nothing about the spec), not doc-vs-code drift. An
        // annotation only — the outcome stays `fail`.
        ...blockedPreconditionAnnotation(scenario.steps, stepIndex),
        failure: {
          step: stepIndex,
          expected: outcome.mismatch.expected,
          actual: outcome.mismatch.actual,
          // The RAW output that produced this mismatch (NOT the normalized text
          // matched against) — head-truncated, empty streams omitted.
          ...(outcome.excerpts ?? {}),
        },
        ...(evidencePath ? { evidencePath } : {}),
      }
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
      })
      const milestone = milestoneOrder(scenario.steps[violationStep - 1]?.milestone)
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
        })
      : undefined
    return { ...base, outcome: 'pass', durationMs: Date.now() - start, ...(evidencePath ? { evidencePath } : {}) }
  } catch (e) {
    // A `${captured:…}` with nothing behind it. The loader's cross-check rejects
    // every committed scenario that could get here, so this is a freshly authored
    // one in birth validation: an author-fixable defect, reported as a `fail`
    // naming the reference (the api driver's `UnknownVariableError` rule), never a
    // literal token handed to a child process.
    if (!(e instanceof CapturedValueError)) throw e
    const mismatch: ExpectMismatch = {
      subject: 'capture',
      expected: `\${captured:${e.variable}} to be captured by an earlier step`,
      actual: e.message,
      detail: [e.message],
    }
    const evidencePath = writeEvidence({
      repoRoot: ctx.repoRoot,
      runId: ctx.runId,
      scenarioId: scenario.id,
      title: scenario.title,
      ...evidenceRefs,
      outcome: 'fail',
      steps: records,
      failingStep: stepInFlight,
      mismatch,
      sandboxCwd: sandbox.cwd,
      envPins: ENV_PINS,
    })
    return {
      ...base,
      outcome: 'fail',
      durationMs: Date.now() - start,
      ...blockedPreconditionAnnotation(scenario.steps, stepInFlight),
      failure: { step: stepInFlight, expected: mismatch.expected, actual: mismatch.actual },
      evidencePath,
    }
  } finally {
    // Every driver's world goes down BEFORE the sandbox directory it acted in: the
    // web surface runs with the sandbox as its cwd, and killing it first is what
    // keeps a scenario from leaving a server holding a deleted directory.
    await closeStepDrivers(drivers)
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


