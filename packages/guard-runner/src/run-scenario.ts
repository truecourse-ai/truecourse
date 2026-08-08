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
  GuardCliStep,
  GuardExpect,
  GuardFileExpect,
  GuardRunArg,
  GuardScenarioResult,
  OutputExcerpts,
} from '@truecourse/shared'
import {
  blockedPreconditionAnnotation,
  isGitStep,
  isOptionalArg,
  isProcessStep,
  isRunStep,
  isWriteStep,
  milestoneOrder,
} from '@truecourse/shared'
import fs from 'node:fs'
import path from 'node:path'
import { createSandbox, resolveInSandbox, SandboxError, DETERMINISM_PINS } from './sandbox.js'
import { overlayStepEnv } from './child-env.js'
import { applyCapabilities, CapabilityError } from './capabilities/index.js'
import { gitChildEnv } from './capabilities/git.js'
import { applySandbox, applySandboxEnv, applySandboxExpect, applySandboxSetup } from './sandbox-token.js'
import {
  applySupplied,
  applySuppliedExpect,
  omitsOptionalPair,
  type SuppliedInstance,
  type SuppliedOmissions,
} from './dependencies.js'
import { startHttpStubs, applyHttpStubOrigins, type HttpStubsHandle } from './capabilities/http.js'
import { startExternalProxies } from './capabilities/external-proxy.js'
import { executeStep, type StepCapture } from './executor.js'
import type { StepObservation } from './step-stats.js'
import { normalize, type NormalizerContext } from './normalizers.js'
import { applyUnique, applyUniqueEnv, applyUniqueSetup } from './unique.js'
import { evaluateExpect } from './expect.js'
import { writeEvidence, stepExcerpt, type EvidenceStep } from './evidence.js'

// Evidence records the exact determinism pins the sandbox applied — one source,
// so what evidence claims can never drift from what the child actually saw.
const ENV_PINS = DETERMINISM_PINS

/**
 * The RAW (un-normalized) stdout/stderr excerpts to ride next to a mismatch — each
 * head-truncated to `STEP_OUTPUT_LIMIT`, each stream omitted when it was empty (no
 * empty-string noise). Spread onto the `failure` at the mismatch site so the
 * birth-retry and the finding see the usage error the program actually printed.
 */
function outputExcerpts(capture: StepCapture): OutputExcerpts {
  const out: OutputExcerpts = {}
  const stdout = stepExcerpt(capture.stdout)
  const stderr = stepExcerpt(capture.stderr)
  if (stdout) out.stdout = stdout
  if (stderr) out.stderr = stderr
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
function applyUniqueExpect<E extends GuardExpect | GuardFileExpect>(expect: E, unique: string): E {
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
  const full = expect as GuardExpect
  return {
    ...expect,
    ...(full.stdout ? { stdout: stream(full.stdout) } : {}),
    ...(full.stderr ? { stderr: stream(full.stderr) } : {}),
    ...(full.output ? { output: stream(full.output) } : {}),
    ...(expect.files
      ? { files: Object.fromEntries(Object.entries(expect.files).map(([k, v]) => [u(k), file(v)])) }
      : {}),
  }
}

/**
 * The empty expectation a `write`/`delete` step that asserts nothing evaluates
 * against — the file steps' `expect` is optional (moving a file is a legitimate
 * silent action), and `evaluateExpect` needs an object either way.
 */
const NO_EXPECTATIONS: GuardExpect = {}

/**
 * The argv a `run` step actually spawns with: every element token-resolved, and
 * every OPTIONAL PAIR whose field this machine left blank dropped whole — flag and
 * value together, so the program falls back to its own default instead of being
 * handed an empty one. Every other token resolves exactly as it always has, which
 * is what keeps the omission scoped to the one case that declared itself optional.
 */
function resolveRunArgv(
  run: readonly GuardRunArg[],
  tok: (text: string) => string,
  omissions: SuppliedOmissions,
): string[] {
  const argv: string[] = []
  for (const arg of run) {
    if (!isOptionalArg(arg)) {
      argv.push(tok(arg))
      continue
    }
    const [flag, value] = arg.optional
    if (omitsOptionalPair(value, omissions)) continue
    argv.push(tok(flag), tok(value))
  }
  return argv
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

    // `${unique}`, `${supplied:…}`, `${sandbox}` — the three tokens a
    // scenario-authored string may carry, resolved with the same surgical substring
    // replacement (never a parser) that `unique.ts` documents. The recipe-owned
    // `resolvedEntry` is never touched.
    const tok = (text: string): string =>
      applySandbox(applySupplied(applyUnique(text, ctx.unique), sandbox.supplied), sandbox.cwd)
    const resolveExpect = <E extends GuardExpect | GuardFileExpect>(expect: E): E =>
      applySandboxExpect(
        applySuppliedExpect(applyUniqueExpect(expect, ctx.unique), sandbox.supplied),
        sandbox.cwd,
      )

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]
      const stepIndex = i + 1
      const stepMilestone = milestoneOrder(step.milestone)
      // Attribute any stub violation raised while this step runs to THIS step.
      stubs?.markStep(stepIndex)

      // Where the step acts: the sandbox cwd, or the sandbox-relative directory it
      // declares (a second repository, a linked worktree, a fresh clone). A path
      // that escapes the sandbox is a scenario defect, reported like a setup escape.
      let stepCwd: string
      try {
        stepCwd = step.cwd ? resolveInSandbox(sandbox.cwd, tok(step.cwd), 'step cwd') : sandbox.cwd
      } catch (e) {
        return {
          ...base,
          outcome: 'error',
          durationMs: Date.now() - start,
          failure: {
            step: stepIndex,
            expected: SANDBOX_SETUP_EXPECTED,
            actual: e instanceof Error ? e.message : String(e),
          },
        }
      }

      // The file steps mutate the sandbox BETWEEN runs — the two-state world a
      // diff-shaped claim needs. They spawn nothing, so they have no exit code and
      // no streams; only their declared file assertions are evaluated.
      if (!isProcessStep(step)) {
        const paths = isWriteStep(step) ? Object.keys(step.write) : step.delete
        try {
          applyFileStep(step, stepCwd, tok)
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          records.push(fileStepRecord(stepIndex, step, paths.map(tok), stepCwd, sandbox.cwd))
          const evidencePath = writeEvidence({
            repoRoot: ctx.repoRoot,
            runId: ctx.runId,
            scenarioId: scenario.id,
            title: scenario.title,
            ...evidenceRefs,
            outcome: 'error',
            steps: records,
            failingStep: stepIndex,
            infraMessage: message,
            sandboxCwd: sandbox.cwd,
            envPins: ENV_PINS,
          })
          return {
            ...base,
            outcome: 'error',
            durationMs: Date.now() - start,
            ...(stepMilestone ? { failedMilestone: stepMilestone } : {}),
            failure: { step: stepIndex, expected: 'the step to run', actual: message },
            evidencePath,
          }
        }
        records.push(fileStepRecord(stepIndex, step, paths.map(tok), stepCwd, sandbox.cwd))
        const mismatch = evaluateExpect({
          expect: step.expect ? resolveExpect(step.expect) : NO_EXPECTATIONS,
          exitCode: null,
          stdout: '',
          stderr: '',
          // `expect.files` is sandbox-relative for EVERY step kind — a step's `cwd`
          // moves where it acts, never where the scenario looks.
          sandboxCwd: sandbox.cwd,
          normalizeText: normText,
        })
        if (mismatch) {
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
            ...(stepMilestone ? { failedMilestone: stepMilestone } : {}),
            ...blockedPreconditionAnnotation(scenario.steps, stepIndex),
            failure: { step: stepIndex, expected: mismatch.expected, actual: mismatch.actual },
            evidencePath,
          }
        }
        continue
      }

      // Substitute the tokens in the scenario-authored argv + stdin + env overlay.
      // Evidence records the RESOLVED overlay — what the child actually saw.
      const argv = isRunStep(step)
        ? [...ctx.resolvedEntry, ...resolveRunArgv(step.run, tok, sandbox.suppliedOmissions)]
        : ['git', ...step.git.map(tok)]
      const stdin = step.stdin === undefined ? undefined : tok(step.stdin)
      const stepEnvOverlay = step.env
        ? applySandboxEnv(applyUniqueEnv(step.env, ctx.unique), sandbox.cwd)
        : undefined
      const repeat = isRunStep(step) ? (step.repeat ?? 1) : 1
      // The step's own budget when it declares one, else the run's. Declared per
      // step because patience is a property of the COMMAND (a run that calls a
      // model takes minutes; the version banner beside it still must not) — and it
      // bounds each `repeat` iteration, exactly as the default does.
      const stepTimeoutMs = step.timeoutMs ?? ctx.stepTimeoutMs
      // This step's env: the scenario sandbox env with the step's own overlay on
      // top, scoped to these child spawns only — the next step sees `sandbox.env`
      // again. `resolvedEntry` was pinned to an absolute interpreter at run start,
      // so a step PATH edit reaches CHILD lookups but never the entrypoint. A `git`
      // step gets the pinned identity and the host config switched off on top of
      // that, so a sandbox commit can never be attributed to the developer.
      const baseEnv = overlayStepEnv(sandbox.env, stepEnvOverlay)
      const stepEnv = isGitStep(step)
        ? gitChildEnv(baseEnv, step.identity ?? setup?.git?.identity)
        : baseEnv
      const invocation = {
        ...(isGitStep(step) ? { kind: 'git' as const } : {}),
        argv,
        stdin,
        ...(step.cwd ? { cwd: step.cwd } : {}),
        ...(isRunStep(step) && step.tty ? { tty: true } : {}),
        ...(stepEnvOverlay ? { env: stepEnvOverlay } : {}),
        repeat,
      }

      let lastCapture: StepCapture | null = null
      for (let iteration = 1; iteration <= repeat; iteration++) {
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
        const capture = await executeStep({
          argv,
          cwd: stepCwd,
          env: stepEnv,
          stdin,
          ...(isRunStep(step) && step.tty ? { tty: true } : {}),
          timeoutMs: stepTimeoutMs,
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
              ? `step timed out after ${stepTimeoutMs}ms`
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
          })
          return {
            ...base,
            outcome: 'error',
            durationMs: Date.now() - start,
            ...(stepMilestone ? { failedMilestone: stepMilestone } : {}),
            failure: { step: stepIndex, expected: 'the step to run', actual: infra },
            evidencePath,
          }
        }

        const normStdout = normText(capture.stdout)
        const normStderr = normText(capture.stderr)
        const mismatch = evaluateExpect({
          expect: resolveExpect(step.expect),
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
            ...(stepMilestone ? { failedMilestone: stepMilestone } : {}),
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
  } finally {
    await stubs?.stop()
    sandbox.cleanup()
  }
}

/**
 * Perform a `write` / `delete` step: materialize or remove sandbox files, in
 * declaration order, resolved against the step's `cwd`. Every path goes through
 * {@link resolveInSandbox}, so a step can only ever touch its own sandbox.
 *
 * A `delete` of a path that is not there THROWS rather than succeeding quietly: the
 * step exists to create a two-state world, and a mistyped path that silently
 * "worked" would let the next assertion pass for the wrong reason.
 */
function applyFileStep(step: GuardCliStep, cwd: string, tok: (text: string) => string): void {
  if (isWriteStep(step)) {
    for (const [rel, content] of Object.entries(step.write)) {
      const target = resolveInSandbox(cwd, tok(rel), 'write')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, tok(content))
    }
    return
  }
  if (!('delete' in step)) return
  for (const rel of step.delete) {
    const target = resolveInSandbox(cwd, tok(rel), 'delete')
    if (!fs.existsSync(target)) {
      throw new SandboxError(`delete: ${rel} does not exist in the sandbox`)
    }
    fs.rmSync(target, { recursive: true, force: true })
  }
}

/**
 * The transcript record of a file step. It spawned nothing, so there is no exit
 * code and no output: the fields exist because every evidence step shares one
 * shape, and they are left empty rather than filled with an invented success.
 */
function fileStepRecord(
  index: number,
  step: GuardCliStep,
  paths: string[],
  stepCwd: string,
  sandboxCwd: string,
): EvidenceStep {
  return {
    index,
    kind: isWriteStep(step) ? 'write' : 'delete',
    argv: paths,
    ...(stepCwd === sandboxCwd ? {} : { cwd: path.relative(sandboxCwd, stepCwd) }),
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
  invocation: Pick<
    EvidenceStep,
    'index' | 'kind' | 'argv' | 'stdin' | 'cwd' | 'tty' | 'env' | 'repeat' | 'iterationsRun'
  >,
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
