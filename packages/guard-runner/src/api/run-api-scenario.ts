/**
 * Run one api scenario end-to-end: seed a sandbox, boot the recipe's server IN
 * that sandbox (fresh state + fresh port per scenario — the api analog of the
 * cli driver's process-per-step isolation), drive the steps over HTTP stopping
 * at the first failing step, and map to a `GuardScenarioResult`. A server that
 * won't boot, a request that can't complete, or a setup escape is an `error`
 * (infrastructure); an unmet expectation or a capture that resolves to nothing
 * is a `fail` (code-side drift candidate). Evidence is written for every
 * EXECUTED outcome — pass included — plus the server's own logs, which is where
 * a 500's stack trace lives. On failures the response body rides the failure's
 * `stdout` excerpt and the server's stderr its `stderr` excerpt, so the birth
 * retry and the findings UI reuse the cli driver's evidence shape unchanged.
 */

import type {
  GuardApiScenario,
  GuardApiRequestStep,
  GuardApiBootStep,
  GuardApiLogsStep,
  GuardApiSignalStep,
  GuardLogMatch,
  GuardScenarioResult,
  OutputExcerpts,
} from '@truecourse/shared'
import {
  blockedPreconditionAnnotation,
  describeApiLifecycleStep,
  isApiBootStep,
  isApiRequestStep,
  isApiSignalStep,
} from '@truecourse/shared'
import { createSandbox, SandboxError, DETERMINISM_PINS } from '../sandbox.js'
import { applyCapabilities, CapabilityError } from '../capabilities/index.js'
import {
  startHttpStubs,
  applyHttpStubOrigins,
  substituteHttpStubOriginsInEnv,
  type HttpStubsHandle,
} from '../capabilities/http.js'
import { startExternalProxies, type ExternalProxiesHandle } from '../capabilities/external-proxy.js'
import type { ExternalProxyTarget } from '../externals.js'
import { normalize, type NormalizerContext } from '../normalizers.js'
import { applyUniqueEnv, applyUniqueSetup } from '../unique.js'
import { SANDBOX_SETUP_EXPECTED, CAPABILITY_SETUP_EXPECTED, FAILURE_OUTPUT_LIMIT } from '../run-scenario.js'
import type { ApiStepObservation } from '../step-stats.js'
import {
  spawnApiProcess,
  startApiServer,
  type ApiServerHandle,
  type StartApiServerResult,
} from './server.js'
import { executeApiRequest, type ApiStepCapture } from './executor.js'
import { CookieJar } from './cookies.js'
import { evaluateApiExpect, parseJsonBody, type ApiExpectMismatch } from './expect.js'
import {
  interpolateRequest,
  interpolateApiExpect,
  lookupJsonPath,
  captureValueToString,
  UnknownVariableError,
  UnknownCredentialError,
  UnknownFixtureError,
  JSON_PATH_MISS,
} from './vars.js'
import { writeApiEvidence, type ApiEvidenceStep } from './evidence.js'
import { buildCredentialRedactor } from './redact.js'

const ENV_PINS = DETERMINISM_PINS

/**
 * Whether the bound server serves a path. `unknown` is the honest default and the
 * only safe one: a path nothing claims, an app whose routes could not be read, or a
 * proxying app all answer `unknown`, and only a positive attribution to ANOTHER app
 * answers `no` — naming it, because "which service owns this path" is the actionable
 * half of the message.
 */
export interface ServesPathVerdict {
  verdict: 'yes' | 'no' | 'unknown'
  /** On `no`, the workspace app dir that DOES serve the path. */
  servedBy?: string
}

export interface RunApiScenarioContext {
  repoRoot: string
  runId: string
  /**
   * The recipe server this scenario is BOUND to (item 75), fully resolved: the
   * absolutized serve argv, and the boot knobs with their defaults applied. A
   * single-server recipe resolves to the one server named `default`, so every boot
   * site below reads one shape regardless of which recipe shape was written.
   *
   * `cwd` is where server processes run: `repo` boots every server (implicit and
   * `boot`-step alike) in the repository root — the only cwd a workspace-mediated
   * serve argv works from; `sandbox` keeps the per-scenario sandbox cwd. Only the
   * server moves: `setup.files`, capabilities and evidence stay sandbox-rooted.
   */
  server: {
    name: string
    /** Absolute-resolved serve argv (see `resolveEntry`). */
    resolvedServe: string[]
    cwd: 'sandbox' | 'repo'
    healthPath: string
    readyTimeoutMs: number
    /** The workspace app it serves (`apps/web`), when the recipe declares one —
     *  the route-manifest join key the 404 triage below reports with. */
    app?: string
  }
  /**
   * Does this scenario's BOUND server serve `path`? (item 76, run-time triage.) A
   * `no` — the path belongs to another workspace app — turns a 404 mismatch into an
   * `error` about the recipe rather than a `fail` about the app, because nothing
   * about the spec was ever exercised. Absent, or any answer other than `no`,
   * behaves exactly as guard did before route awareness existed (R6).
   */
  servesPath?: (path: string) => ServesPathVerdict
  /** The BOUND server's env — recipe `env` ⊕ `api.env` ⊕ the server's own `env`. */
  recipeEnv?: Record<string, string>
  /**
   * Resolved api credentials (name → secret value) the runner injects into steps
   * referencing `{{cred:<name>}}`. The same values are masked back out of evidence
   * and failure output. Absent/empty ⇒ no substitution and no redaction.
   */
  credentials?: ReadonlyMap<string, string>
  /**
   * Credentials the recipe declares but this scenario's BOUND SERVER is not on
   * (their `servers` allowlist, item 75 / R8): name → the servers it does
   * authenticate against. They are deliberately absent from `credentials`, so a
   * `{{cred:…}}` reference to one is a scenario `error` — and this map is what
   * turns that error's text from "undeclared" into the actionable truth.
   */
  foreignCredentials?: ReadonlyMap<string, readonly string[]>
  /**
   * Secret env values of the PROVIDED external API accounts (item 62), keyed
   * `<service>.<VAR>`. NOT injectable into steps (the app consumes them, not the
   * scenario) — they exist here for ONE reason: they join the redactor, so an
   * upstream key the app forwards can never land in an evidence transcript.
   */
  externalSecrets?: ReadonlyMap<string, string>
  /**
   * Every PROVIDED external service and its base-URL variables (item 64). Each
   * (service, variable) is bound to a per-scenario loopback proxy whose upstream is
   * the real origin, and the scenario's `setup.externals` scripts faults on it.
   * Empty/absent ⇒ no proxies, and any `setup.externals` block is a scenario error.
   */
  externalTargets?: readonly ExternalProxyTarget[]
  /**
   * Seeded fixtures (name → { field → NATIVE JSON value }) the runner substitutes
   * into `{{fixture:<name>.<field>}}` placeholders in the path, query, headers, and
   * body. In a longer string a fixture is stringified; as a WHOLE JSON-body leaf or
   * whole expect-matcher value it keeps its native type. Not secrets — never redacted.
   * Absent ⇒ any `{{fixture:…}}` reference is an undeclared-fixture scenario error.
   * See {@link runSeed}.
   */
  fixtures?: ReadonlyMap<string, Record<string, unknown>>
  /**
   * This scenario's `${unique}` token — seeded into the step-vars map before the
   * first step so `${unique}` interpolates anywhere `${var}` does (path, header
   * values, body). Stable across the scenario's steps, distinct per scenario in a
   * run (see {@link scenarioUnique}), so a resource the scenario CREATES carries a
   * collision-free identifier.
   */
  unique: string
  stepTimeoutMs: number
  signal?: AbortSignal
  capturePassEvidence: boolean
  /**
   * Fired once per executed request invocation (each `repeat` iteration counts)
   * with a compact capture observation. The runner aggregates these across the
   * run into the no-op anomaly stats (C4); nothing is persisted. A request that
   * never reached the server (connection refused) is not reported — the api
   * analogue of a cli spawn failure.
   */
  onStep?: (observation: ApiStepObservation) => void
  /**
   * B5: the bound OpenAPI operation's identity plus its declared JSON response
   * schema per asserted status, consulted by `expect.schema: true` steps. Absent
   * when the scenario is NOT bound to an OpenAPI operation — then any `schema: true`
   * step is a scenario `error` (never a silent pass). Built once per scenario in
   * {@link runGuard} from the bound doc's canonical operation slice.
   */
  responseSchemas?: {
    /** Bound operation's HTTP method (upper-case). */
    method: string
    /** Bound operation's path template (`/todos/{id}`). */
    path: string
    /** Asserted status → declared JSON response schema (only statuses that resolve one). */
    byStatus: ReadonlyMap<number, unknown>
  }
}

/**
 * Resolve the response schema a `schema: true` step must validate against, or a
 * hard-`error` reason (never a silent pass). The scenario must bind to an OpenAPI
 * operation (`responseSchemas` present), the step must assert an exact status, hit
 * the BOUND operation (the multi-op guard — a `schema: true` step against a
 * different endpoint validates nothing meaningful), and that operation must declare
 * a JSON response schema for the asserted status.
 */
function resolveStepSchema(
  step: GuardApiRequestStep,
  responseSchemas: RunApiScenarioContext['responseSchemas'],
): { schema: unknown } | { error: string } {
  if (!responseSchemas) {
    return {
      error:
        'response-schema conformance (`schema: true`) requires the scenario to bind to an OpenAPI operation, but its bound section is not one',
    }
  }
  const status = step.expect.status
  if (status === undefined) {
    return { error: 'response-schema conformance (`schema: true`) requires the step to assert an exact `status`' }
  }
  if (!sameEndpoint(step.request.method, step.request.path, responseSchemas.method, responseSchemas.path)) {
    return {
      error: `response-schema conformance (\`schema: true\`) validates against the bound operation ${responseSchemas.method} ${responseSchemas.path}, but this step requests ${step.request.method} ${step.request.path}`,
    }
  }
  const schema = responseSchemas.byStatus.get(status)
  if (schema === undefined) {
    return {
      error: `schema conformance requested but the bound operation ${responseSchemas.method} ${responseSchemas.path} declares no JSON response schema for status ${status}`,
    }
  }
  return { schema }
}

/** Fold a path into method + comparable segments (params/ids/`${vars}` → `*`). */
function foldPathSegments(p: string): string[] {
  return p
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .map((seg) =>
      /^\{.*\}$/.test(seg) || /^:/.test(seg) || /^<.*>$/.test(seg) || /^\d+$/.test(seg) || seg === '*' || /\$\{[^}]*\}/.test(seg)
        ? '*'
        : seg,
    )
}

/** True when a request line addresses the same operation as the bound op template. */
function sameEndpoint(methodA: string, pathA: string, methodB: string, pathB: string): boolean {
  if (methodA.toUpperCase() !== methodB.toUpperCase()) return false
  const a = foldPathSegments(pathA)
  const b = foldPathSegments(pathB)
  return a.length === b.length && a.every((s, i) => s === b[i] || s === '*' || b[i] === '*')
}

/** The captured output of every server process one scenario ran, in boot order. */
interface ServerLogs {
  stdout: string
  stderr: string
}

/** A position in each captured stream — the base of a `sinceLastStep` window. */
interface LogMark {
  stdout: number
  stderr: number
}

/** Default budget for a signalled process to exit (`signal.expect.withinMs`). */
const SIGNAL_EXIT_TIMEOUT_MS = 10_000
/** Default window a `logs` step waits for its expected lines to appear. */
const LOGS_WAIT_MS = 2_000
/** Poll interval while a `logs` step waits. */
const LOGS_POLL_INTERVAL_MS = 25

/** The failing-step excerpts: response body as `stdout`, server stderr as `stderr`. */
function apiExcerpts(
  capture: ApiStepCapture | null,
  serverLogs: ServerLogs,
  redact: (t: string) => string,
): OutputExcerpts {
  const out: OutputExcerpts = {}
  if (capture?.bodyText) out.stdout = redact(capture.bodyText.slice(0, FAILURE_OUTPUT_LIMIT))
  if (serverLogs.stderr) out.stderr = redact(serverLogs.stderr.slice(-FAILURE_OUTPUT_LIMIT))
  return out
}

/** `“x”` / `/x/` — how a log matcher reads in a failure message. */
function logMatchLabel(m: GuardLogMatch): string {
  return typeof m === 'string' ? `“${m}”` : `/${m.pattern}/`
}

/** The lines of a log window that match — substring or regex, per LINE. */
function matchingLogLines(window: string, match: GuardLogMatch): string[] {
  const lines = window.split('\n').filter((l) => l.length > 0)
  if (typeof match === 'string') return lines.filter((l) => l.includes(match))
  const re = new RegExp(match.pattern)
  return lines.filter((l) => re.test(l))
}

/** How a closed process went down, in the words a failure message needs. */
function exitLabel(exit: { code: number | null; signal: NodeJS.Signals | null }): string {
  if (exit.code !== null) return `exited with code ${exit.code}`
  return exit.signal ? `was killed by ${exit.signal}` : 'exited without a code'
}

export async function runApiScenario(
  scenario: GuardApiScenario,
  ctx: RunApiScenarioContext,
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
  const credentials = ctx.credentials ?? new Map<string, string>()
  const fixtures = ctx.fixtures ?? new Map<string, Record<string, unknown>>()
  const redact = buildCredentialRedactor(credentials, ctx.externalSecrets)

  // `${unique}` resolves in the seeded world-state before it materializes, exactly as
  // it does for the request side below (see {@link applyUniqueSetup}) — a seeded path
  // and a request that names it must agree on the token.
  const declaredSetup = applyUniqueSetup(scenario.setup, ctx.unique)

  // The `http` capability comes up FIRST — before the sandbox env is built and thus
  // before the server boots — because the app reads its stubbed dependency's base URL
  // from `setup.env`, which only now can carry the allocated origins. A stub that
  // cannot listen (or a `${HTTP_STUB:…}` naming an undeclared stub) is infrastructure.
  let stubs: HttpStubsHandle | null = null
  let proxies: ExternalProxiesHandle | null = null
  let setup = declaredSetup
  // The base URL of every PROVIDED external is rewritten to a per-scenario proxy
  // (item 64), which forwards to the real account unless the scenario scripts a
  // fault. It layers UNDER `setup.env`: a scenario that points the same variable at
  // a stub keeps winning, and that variable then gets no proxy at all.
  let proxyEnv: Record<string, string> | undefined
  try {
    stubs = await startHttpStubs(declaredSetup?.http)
    if (stubs) setup = applyHttpStubOrigins(declaredSetup, stubs.origins)
    proxies = await startExternalProxies({
      targets: ctx.externalTargets ?? [],
      scripts: declaredSetup?.externals,
      overriddenEnv: Object.keys(setup?.env ?? {}),
    })
    if (proxies) proxyEnv = { ...proxies.env }
  } catch (e) {
    await proxies?.stop()
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
      // The proxy origins REPLACE the real base URLs the run-level env carries, and
      // sit under the scenario's own `setup.env` — the item-62 precedence
      // (`setup.env` > externals > `api.env`) is unchanged, with the externals layer
      // now pointing at the proxy in front of the account rather than at the account.
      recipeEnv: proxyEnv ? { ...(ctx.recipeEnv ?? {}), ...proxyEnv } : ctx.recipeEnv,
      scenarioEnv: setup?.env,
      setupFiles: setup?.files,
    })
  } catch (e) {
    await proxies?.stop()
    await stubs?.stop()
    const message = e instanceof SandboxError ? e.message : e instanceof Error ? e.message : String(e)
    return {
      ...base,
      outcome: 'error',
      durationMs: Date.now() - start,
      failure: { step: 1, expected: SANDBOX_SETUP_EXPECTED, actual: message },
    }
  }

  // Where every server process of this scenario boots (see `serveCwd`); the sandbox
  // stays the home of everything else the scenario touches.
  const bootCwd = ctx.server.cwd === 'repo' ? ctx.repoRoot : sandbox.cwd

  const normCtx: NormalizerContext = { sandboxRoot: sandbox.root, repoRoot: ctx.repoRoot }
  const normText = (t: string): string => normalize(t, scenario.normalize, normCtx)
  const records: ApiEvidenceStep[] = []
  let server: ApiServerHandle | null = null
  // The output of every server process this scenario ran, ACCUMULATED: a scenario
  // that restarts the server keeps the first boot's log lines readable (and its
  // evidence complete) after the second boot replaced the handle.
  const retired: ServerLogs = { stdout: '', stderr: '' }
  /** Everything every server of this scenario has written so far. */
  const serverLogs = (): ServerLogs => {
    const live = server?.logs() ?? { stdout: '', stderr: '' }
    return { stdout: retired.stdout + live.stdout, stderr: retired.stderr + live.stderr }
  }
  /** Stop the running server (if any) and fold its output into the accumulator. */
  const retireServer = async (): Promise<void> => {
    if (!server) return
    await server.stop()
    const last = server.logs()
    retired.stdout += last.stdout
    retired.stderr += last.stderr
    server = null
  }

  try {
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

    // A scenario that declares its own `boot` step owns the server lifecycle from
    // its first step on; every other scenario keeps the implicit boot the api driver
    // has always done. Back-compat is by construction: nothing an existing scenario
    // says changes what happens to it.
    const ownsLifecycle = scenario.steps.some(isApiBootStep)
    // Success-after-retry is recorded on every downstream outcome (pass/fail/error),
    // so a scenario that only came up on the second boot is never silent.
    let bootAttempts: number | undefined

    if (!ownsLifecycle) {
      // Boot the server in the sandbox — fresh state dir + fresh port per scenario.
      // A failed boot is retried ONCE (fresh port — `startApiServer` allocates its own
      // each call): the diagnosed cal.com failure was transient host pressure that a lone
      // retry clears. A recipe/env defect (missing credential env, undeclared fixture)
      // fires BEFORE the boot, so it never reaches this retry and never wastes an attempt.
      const { boot, attempts } = await bootWithRetry(ctx, bootCwd, sandbox.env)
      if (ctx.signal?.aborted) return abortedResult(base, 1, start)
      if (!boot.ok) {
        return {
          ...base,
          outcome: 'error',
          durationMs: Date.now() - start,
          ...(attempts > 1 ? { bootAttempts: attempts } : {}),
          failure: {
            step: 1,
            expected: 'the api server to start',
            // The message names the retry so a persisted error shows the boot was tried twice.
            actual: attempts > 1 ? `${boot.reason} (boot failed on both of ${attempts} attempts)` : boot.reason,
            ...(boot.stdout ? { stdout: redact(boot.stdout.slice(-FAILURE_OUTPUT_LIMIT)) } : {}),
            ...(boot.stderr ? { stderr: redact(boot.stderr.slice(-FAILURE_OUTPUT_LIMIT)) } : {}),
          },
        }
      }
      server = boot.server
      if (attempts > 1) bootAttempts = attempts
    }
    /** True once ANY server process of this scenario has been spawned. */
    let everBooted = !ownsLifecycle
    /** Log lengths as of the START of the previous step — a `logs` window's base. */
    let previousStepMark: LogMark = { stdout: 0, stderr: 0 }

    // Seed `${unique}` before the first step: it is available to every step's
    // interpolation exactly like a captured var, but stable for the whole scenario.
    const vars = new Map<string, string>([['unique', ctx.unique]])
    // Parallel NATIVE captures (`${var}` → the raw JSON value an earlier step captured).
    // A whole-value `${var}` leaf/expect substitutes this native type; the string `vars`
    // map still drives every mixed-string interpolation. `${unique}` is a string token, so
    // it lives only in `vars` and takes the string path (no native entry).
    const nativeVars = new Map<string, unknown>()
    // One jar per scenario, born with this scenario's server and discarded with it
    // — a login step's session cookie reaches every LATER step of THIS scenario and
    // no other (see `./cookies.js`).
    const cookies = new CookieJar()

    /** An `error` outcome for a step — infrastructure, never a code-side verdict. */
    const errorAt = (
      stepIndex: number,
      milestone: number | undefined,
      expected: string,
      actual: string,
    ): GuardScenarioResult => ({
      ...base,
      outcome: 'error',
      durationMs: Date.now() - start,
      ...(bootAttempts ? { bootAttempts } : {}),
      ...(milestone ? { failedMilestone: milestone } : {}),
      failure: { step: stepIndex, expected, actual },
    })

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]
      const stepIndex = i + 1
      // Attribute any stub violation raised while this step runs to THIS step.
      stubs?.markStep(stepIndex)
      // Taken BEFORE the step runs, and handed to the NEXT step: a `logs` step's
      // `sinceLastStep` window is everything the step before it produced.
      const markAtStart: LogMark = {
        stdout: serverLogs().stdout.length,
        stderr: serverLogs().stderr.length,
      }

      // --- The process-lifecycle steps ---------------------------------------
      if (!isApiRequestStep(step)) {
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
        const fail = (expected: string, actual: string, detail?: string[]): GuardScenarioResult => {
          records.push(lifecycleRecord(stepIndex, step))
          return failResult(
            base,
            scenario,
            ctx,
            sandbox.cwd,
            serverLogs(),
            records,
            stepIndex,
            step.milestone,
            start,
            { subject: 'process', expected, actual, ...(detail ? { detail } : {}) },
            null,
            redact,
            bootAttempts,
          )
        }

        if (isApiBootStep(step)) {
          // A boot always replaces whatever is running — its output is folded into
          // the scenario's accumulator first, so nothing a restart printed is lost.
          await retireServer()
          let bootEnv = sandbox.env
          if (step.boot.env) {
            try {
              const overlay = substituteHttpStubOriginsInEnv(
                applyUniqueEnv(step.boot.env, ctx.unique),
                stubs?.origins ?? new Map<string, string>(),
                `step ${stepIndex} boot.env`,
              )
              bootEnv = { ...sandbox.env, ...overlay }
            } catch (e) {
              const message = e instanceof CapabilityError ? e.message : e instanceof Error ? e.message : String(e)
              return errorAt(stepIndex, step.milestone, CAPABILITY_SETUP_EXPECTED, message)
            }
          }
          const expectation = step.boot.expect
          const expectsExit = expectation !== undefined && expectation.ready === undefined

          if (!expectsExit) {
            const { boot, attempts } = await bootWithRetry(ctx, bootCwd, bootEnv)
            if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
            everBooted = true
            if (attempts > 1) bootAttempts = attempts
            if (!boot.ok) {
              retired.stdout += boot.stdout
              retired.stderr += boot.stderr
              // A child that could not be SPAWNED is infrastructure: there is no
              // process whose readiness could have been judged.
              if (boot.spawnFailed) return errorAt(stepIndex, step.milestone, 'the api server to start', boot.reason)
              return fail('the server to boot and become healthy', boot.reason)
            }
            server = boot.server
          } else {
            const spawned = await spawnApiProcess({
              resolvedServe: ctx.server.resolvedServe,
              cwd: bootCwd,
              env: bootEnv,
              healthPath: ctx.server.healthPath,
              readyTimeoutMs: ctx.server.readyTimeoutMs,
              signal: ctx.signal,
            })
            everBooted = true
            server = spawned.server
            const exit = await server.waitForExit(ctx.server.readyTimeoutMs)
            const bootLogs = server.logs()
            await retireServer()
            if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
            if (spawned.spawnError()) {
              return errorAt(stepIndex, step.milestone, 'the api server to start', `api server failed to spawn: ${spawned.spawnError()}`)
            }
            if (!exit.exited) {
              return fail(
                'the server process to exit',
                `it was still running ${ctx.server.readyTimeoutMs}ms after it started`,
              )
            }
            if (expectation.exitCode !== undefined && exit.code !== expectation.exitCode) {
              return fail(`the server process to exit with code ${expectation.exitCode}`, `it ${exitLabel(exit)}`, [
                `--- stderr ---`,
                bootLogs.stderr.slice(-FAILURE_OUTPUT_LIMIT),
              ])
            }
            for (const needle of expectation.stderrContains ?? []) {
              if (!bootLogs.stderr.includes(needle)) {
                return fail(`the failing startup to write “${needle}” to stderr`, 'it did not', [
                  `--- stderr ---`,
                  bootLogs.stderr.slice(-FAILURE_OUTPUT_LIMIT),
                ])
              }
            }
          }
          records.push(lifecycleRecord(stepIndex, step))
          previousStepMark = markAtStart
          continue
        }

        if (isApiSignalStep(step)) {
          if (!server) {
            return errorAt(
              stepIndex,
              step.milestone,
              'a running server to signal',
              'no server is running — a `boot` step must start one before it can be signalled',
            )
          }
          server.signal(step.signal.name)
          const expectation = step.signal.expect
          if (expectation) {
            const budget = expectation.withinMs ?? SIGNAL_EXIT_TIMEOUT_MS
            const exit = await server.waitForExit(budget)
            if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
            if (!exit.exited) {
              await retireServer()
              return fail(
                `the server to exit within ${budget}ms of ${step.signal.name}`,
                'it was still running at the deadline',
              )
            }
            if (expectation.exitCode !== undefined && exit.code !== expectation.exitCode) {
              const detail = [`--- stderr ---`, serverLogs().stderr.slice(-FAILURE_OUTPUT_LIMIT)]
              await retireServer()
              return fail(
                `the server to exit with code ${expectation.exitCode} on ${step.signal.name}`,
                `it ${exitLabel(exit)}`,
                detail,
              )
            }
          }
          // A dead process is retired immediately, so a later step sees "no server
          // running" rather than a handle onto a corpse.
          if (server.exit()) await retireServer()
          records.push(lifecycleRecord(stepIndex, step))
          previousStepMark = markAtStart
          continue
        }

        // `logs` — assert on what the server process wrote.
        if (!everBooted) {
          return errorAt(
            stepIndex,
            step.milestone,
            'a server whose output can be read',
            'no server has been started yet — a `boot` step must precede a `logs` step',
          )
        }
        const { stream, match } = step.logs
        const from = step.logs.sinceLastStep ? previousStepMark[stream] : 0
        const want = step.logs.count ?? 1
        const deadline = Date.now() + (step.logs.withinMs ?? LOGS_WAIT_MS)
        let matches = matchingLogLines(serverLogs()[stream].slice(from), match)
        while (matches.length < want && Date.now() < deadline) {
          if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)
          await new Promise((r) => setTimeout(r, LOGS_POLL_INTERVAL_MS))
          matches = matchingLogLines(serverLogs()[stream].slice(from), match)
        }
        const window = serverLogs()[stream].slice(from)
        const satisfied = step.logs.count === undefined ? matches.length >= 1 : matches.length === step.logs.count
        if (!satisfied) {
          const scope = step.logs.sinceLastStep ? ' since the previous step' : ''
          return fail(
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

      // --- A request step ------------------------------------------------------
      if (!server) {
        return errorAt(
          stepIndex,
          step.milestone,
          'a running server to request',
          'no server is running — a `boot` step must start one before a request can be sent',
        )
      }
      const repeat = step.repeat ?? 1

      for (let iteration = 1; iteration <= repeat; iteration++) {
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)

        // One credential-aware pass: `${var}` interpolation plus `{{cred:name}}`
        // header substitution. An unknown `${var}` is an authoring defect the birth
        // retry can fix from the message — a `fail`, not infrastructure; a
        // `{{cred:name}}` the recipe never declared is a scenario-level `error`
        // surfaced loudly, never a silent pass.
        let request
        // The EXPECTATION's matcher values interpolate with the request's surface
        // MINUS credentials (a secret stays header-only) — `${var}`/`${unique}` and
        // `{{fixture:…}}` resolve, `{{cred:…}}` stays literal — so an assertion can
        // name what a scenario created and the failure shows the resolved value.
        let stepExpect = step.expect
        try {
          request = interpolateRequest(step.request, vars, credentials, fixtures, nativeVars)
          stepExpect = interpolateApiExpect(step.expect, vars, fixtures, nativeVars)
        } catch (e) {
          if (e instanceof UnknownVariableError) {
            records.push(toRecord(stepIndex, step, step.request.path, null, repeat, iteration, normText, undefined))
            return failResult(base, scenario, ctx, sandbox.cwd, serverLogs(), records, stepIndex, step.milestone, start, {
              expected: `\${${e.variable}} to be captured by an earlier step`,
              actual: e.message,
            }, null, redact, bootAttempts)
          }
          if (e instanceof UnknownCredentialError) {
            // A credential the recipe DOES declare, just not for this scenario's
            // server, is a different mistake with a different fix — say which.
            const foreign = ctx.foreignCredentials?.get(e.credential)
            return {
              ...base,
              outcome: 'error',
              durationMs: Date.now() - start,
              ...(bootAttempts ? { bootAttempts } : {}),
              ...(step.milestone ? { failedMilestone: step.milestone } : {}),
              failure: {
                step: stepIndex,
                expected: foreign
                  ? `credential "${e.credential}" to authenticate against server "${ctx.server.name}", which this scenario runs on`
                  : `credential "${e.credential}" to be declared in the recipe's api.credentials`,
                actual: foreign
                  ? `the recipe declares it for ${foreign.map((s) => `"${s}"`).join(', ')} only — add "${ctx.server.name}" to its \`servers\` list in recipe.json, or bind this scenario to a server it authenticates against`
                  : e.message,
              },
            }
          }
          if (e instanceof UnknownFixtureError) {
            return {
              ...base,
              outcome: 'error',
              durationMs: Date.now() - start,
              ...(bootAttempts ? { bootAttempts } : {}),
              ...(step.milestone ? { failedMilestone: step.milestone } : {}),
              failure: {
                step: stepIndex,
                expected: `fixture "${e.fixture}" to be declared in the recipe's api.seed.provides.fixtures`,
                actual: e.message,
              },
            }
          }
          throw e
        }

        const capture = await executeApiRequest({
          baseUrl: server.baseUrl,
          request,
          timeoutMs: ctx.stepTimeoutMs,
          signal: ctx.signal,
          cookies,
        })
        // Aggregate every request that reached the server (completed or timed
        // out); one the connection refused observed nothing. The request line is
        // the DECLARED one, so interpolated variants of a route are one route.
        if (!capture.requestError) {
          ctx.onStep?.({
            status: capture.status,
            bodyEmpty: capture.bodyText.length === 0,
            timedOut: capture.timedOut,
            requestLine: `${step.request.method.toUpperCase()} ${step.request.path}`,
            durationMs: capture.durationMs,
          })
        }
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)

        // Infrastructure problem — the health-checked server stopped answering.
        if (capture.requestError || capture.timedOut) {
          const infra = capture.timedOut
            ? `request timed out after ${ctx.stepTimeoutMs}ms`
            : `request failed: ${capture.requestError}`
          records.push(toRecord(stepIndex, step, request.path, capture, repeat, iteration, normText, undefined))
          const evidencePath = writeApiEvidence({
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
            serverLogs: serverLogs(),
            redact,
          })
          return {
            ...base,
            outcome: 'error',
            durationMs: Date.now() - start,
            ...(bootAttempts ? { bootAttempts } : {}),
            ...(step.milestone ? { failedMilestone: step.milestone } : {}),
            failure: { step: stepIndex, expected: 'the request to complete', actual: infra, ...apiExcerpts(capture, serverLogs(), redact) },
            evidencePath,
          }
        }

        // B5: resolve the response schema for a `schema: true` step. An unresolvable
        // request (not bound to an operation, no declared schema for the status, or a
        // multi-op endpoint mismatch) is a scenario ERROR — never a silent pass.
        let responseSchema: unknown
        if (stepExpect.schema === true) {
          const resolved = resolveStepSchema(step, ctx.responseSchemas)
          if ('error' in resolved) {
            return {
              ...base,
              outcome: 'error',
              durationMs: Date.now() - start,
              ...(bootAttempts ? { bootAttempts } : {}),
              ...(step.milestone ? { failedMilestone: step.milestone } : {}),
              failure: {
                step: stepIndex,
                expected: 'the step to assert response-schema conformance against a bound operation',
                actual: resolved.error,
              },
            }
          }
          responseSchema = resolved.schema
        }

        const normBody = normText(capture.bodyText)
        const mismatch = evaluateApiExpect({
          expect: stepExpect,
          status: capture.status,
          headers: capture.headers,
          bodyText: normBody,
          rawBodyText: capture.bodyText,
          normalizeText: normText,
          responseSchema,
        })
        if (mismatch) {
          records.push(toRecord(stepIndex, step, request.path, capture, repeat, iteration, normText, undefined))
          // Item 76: a 404 on a path ANOTHER workspace app serves is infrastructure,
          // not drift — the recipe declares no server for the service that owns the
          // path, so this scenario never reached the behavior it asserts. The carve-out
          // (R7) is a step that EXPECTS 404: "an unknown path answers 404" is a real
          // claim, and it must keep failing/passing on its own terms.
          const unserved =
            mismatch.subject === 'status' && capture.status === 404 && stepExpect.status !== 404
              ? ctx.servesPath?.(request.path)
              : undefined
          if (unserved?.verdict === 'no') {
            const boundApp = ctx.server.app ? ` (${ctx.server.app})` : ''
            const expected = `the bound server "${ctx.server.name}"${boundApp} to serve ${request.method} ${request.path}`
            const actual =
              `404 — ${request.path} is served by ${unserved.servedBy ?? 'another workspace app'}, which this recipe declares no server for. ` +
              'Declare it under api.servers in .truecourse/scenarios/recipe.json and re-run `guard generate`.'
            const evidencePath = writeApiEvidence({
              repoRoot: ctx.repoRoot,
              runId: ctx.runId,
              scenarioId: scenario.id,
              title: scenario.title,
              ...evidenceRefs,
              outcome: 'error',
              steps: records,
              failingStep: stepIndex,
              infraMessage: actual,
              sandboxCwd: sandbox.cwd,
              envPins: ENV_PINS,
              serverLogs: serverLogs(),
              redact,
            })
            return {
              ...base,
              outcome: 'error',
              unservedRoute: true,
              durationMs: Date.now() - start,
              ...(bootAttempts ? { bootAttempts } : {}),
              ...(step.milestone ? { failedMilestone: step.milestone } : {}),
              failure: { step: stepIndex, expected, actual, ...apiExcerpts(capture, serverLogs(), redact) },
              evidencePath,
            }
          }
          return failResult(base, scenario, ctx, sandbox.cwd, serverLogs(), records, stepIndex, step.milestone, start, mismatch, capture, redact, bootAttempts)
        }

        // Captures resolve AFTER the expectation holds; a path that resolves to
        // nothing is drift evidence (the response shape changed) — a `fail`.
        let captured: Record<string, string> | undefined
        // Header captures first — they share the `${name}` namespace with body
        // captures and fail the same way, but need no body parse. `capture.headers`
        // land in `captured` too, so evidence shows every variable this step set.
        if (step.captureHeaders && Object.keys(step.captureHeaders).length > 0) {
          captured = {}
          for (const [name, headerName] of Object.entries(step.captureHeaders)) {
            const value = capture.headers[headerName.toLowerCase()]
            if (value === undefined) {
              records.push(toRecord(stepIndex, step, request.path, capture, repeat, iteration, normText, captured))
              return failResult(base, scenario, ctx, sandbox.cwd, serverLogs(), records, stepIndex, step.milestone, start, {
                expected: `capture "${name}" from response header "${headerName}"`,
                actual: 'the response carries no such header',
              }, capture, redact, bootAttempts)
            }
            captured[name] = value
            vars.set(name, value)
            // A header value is text on the wire; the native map keeps the same
            // string so a whole-value `${name}` leaf behaves like the string form.
            nativeVars.set(name, value)
          }
        }
        if (step.capture && Object.keys(step.capture).length > 0) {
          const parsed = parseJsonBody(capture.bodyText)
          captured = captured ?? {}
          for (const [name, jsonPath] of Object.entries(step.capture)) {
            const value = 'error' in parsed ? JSON_PATH_MISS : lookupJsonPath(parsed.value, jsonPath)
            if (value === JSON_PATH_MISS) {
              records.push(toRecord(stepIndex, step, request.path, capture, repeat, iteration, normText, captured))
              return failResult(base, scenario, ctx, sandbox.cwd, serverLogs(), records, stepIndex, step.milestone, start, {
                expected: `capture "${name}" at json path "${jsonPath}"`,
                actual:
                  'error' in parsed
                    ? `response body is not JSON: ${parsed.error}`
                    : 'the path resolved to nothing',
              }, capture, redact, bootAttempts)
            }
            const str = captureValueToString(value)
            captured[name] = str
            vars.set(name, str)
            // Keep the native captured value too, so a later whole-value `${name}` leaf
            // or expect compares in its JSON type (a numeric id as `3`, not `"3"`).
            nativeVars.set(name, value)
          }
        }

        if (iteration === repeat) {
          records.push(toRecord(stepIndex, step, request.path, capture, repeat, iteration, normText, captured))
        }
      }
      previousStepMark = markAtStart
    }

    // Every step met its expectations — but the scenario passes only if its stubs
    // also saw exactly what was declared. An unscripted third-party call, a request
    // assertion the app violated, or a wrong call count is a FINDING (the app-vs-third
    // party contract), so it settles as a `fail` on the step it happened during (the
    // `calls` check has no step — it is attributed to the last one).
    const violation = stubs?.settle() ?? null
    if (violation) {
      const violationStep = violation.step ?? scenario.steps.length
      return failResult(
        base,
        scenario,
        ctx,
        sandbox.cwd,
        serverLogs(),
        records,
        violationStep,
        scenario.steps[violationStep - 1]?.milestone,
        start,
        {
          subject: 'stub',
          expected: violation.expected,
          actual: violation.actual,
          // Recorded requests can carry a credential the app forwarded upstream, so
          // every excerpt goes through the scenario's redactor before it is written.
          detail: violation.detail.map(redact),
        },
        null,
        redact,
        bootAttempts,
      )
    }

    // Same settlement for the externals proxy (item 64): a scripted FAULT is never a
    // failure (it is the world the scenario declared), but a `calls` count mismatch
    // is — "it did not retry" and "this mode never calls the vendor" are assertions.
    const externalViolation = proxies?.settle() ?? null
    if (externalViolation) {
      const lastStep = scenario.steps.length
      return failResult(
        base,
        scenario,
        ctx,
        sandbox.cwd,
        serverLogs(),
        records,
        lastStep,
        scenario.steps[lastStep - 1]?.milestone,
        start,
        {
          subject: 'external',
          expected: externalViolation.expected,
          actual: externalViolation.actual,
          // Every recorded call carries the app's upstream credentials in its
          // headers, so the excerpt goes through the scenario's redactor first.
          detail: externalViolation.detail.map(redact),
        },
        null,
        redact,
        bootAttempts,
      )
    }

    const evidencePath = ctx.capturePassEvidence
      ? writeApiEvidence({
          repoRoot: ctx.repoRoot,
          runId: ctx.runId,
          scenarioId: scenario.id,
          title: scenario.title,
          ...evidenceRefs,
          outcome: 'pass',
          steps: records,
          sandboxCwd: sandbox.cwd,
          envPins: ENV_PINS,
          serverLogs: serverLogs(),
          redact,
        })
      : undefined
    return { ...base, outcome: 'pass', durationMs: Date.now() - start, ...(bootAttempts ? { bootAttempts } : {}), ...(evidencePath ? { evidencePath } : {}) }
  } finally {
    await server?.stop()
    await proxies?.stop()
    await stubs?.stop()
    sandbox.cleanup()
  }
}

/** Settle a `fail` with its evidence bundle (shared by expect, var, and capture misses). */
function failResult(
  base: Pick<GuardScenarioResult, 'id' | 'title' | 'binds' | 'flowId'>,
  scenario: GuardApiScenario,
  ctx: RunApiScenarioContext,
  sandboxCwd: string,
  serverLogs: ServerLogs,
  records: ApiEvidenceStep[],
  stepIndex: number,
  /** The failing step's flow milestone, when it realizes one. */
  milestone: number | undefined,
  start: number,
  mismatch: { expected: string; actual: string; subject?: string; detail?: string[] },
  capture: ApiStepCapture | null,
  redact: (t: string) => string,
  bootAttempts: number | undefined,
): GuardScenarioResult {
  const evidencePath = writeApiEvidence({
    repoRoot: ctx.repoRoot,
    runId: ctx.runId,
    scenarioId: scenario.id,
    title: scenario.title,
    binds: scenario.binds,
    ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
    outcome: 'fail',
    steps: records,
    failingStep: stepIndex,
    mismatch: {
      subject: (mismatch.subject ?? 'json') as ApiExpectMismatch['subject'],
      expected: mismatch.expected,
      actual: mismatch.actual,
      detail: mismatch.detail ?? [`expected: ${mismatch.expected}`, `actual:   ${mismatch.actual}`],
    },
    sandboxCwd,
    envPins: ENV_PINS,
    serverLogs,
    redact,
  })
  return {
    ...base,
    outcome: 'fail',
    durationMs: Date.now() - start,
    ...(bootAttempts ? { bootAttempts } : {}),
    ...(milestone ? { failedMilestone: milestone } : {}),
    // A failure on a step that asserts nothing about the spec (the seeding POST at
    // the head of a flow, the login) is a blocked PRECONDITION, not drift — the
    // annotation says so; the outcome stays `fail`.
    ...blockedPreconditionAnnotation(scenario.steps, stepIndex),
    failure: {
      step: stepIndex,
      expected: redact(mismatch.expected),
      actual: redact(mismatch.actual),
      ...apiExcerpts(capture, serverLogs, redact),
    },
    evidencePath,
  }
}

/**
 * Boot the api server, retrying ONCE on a HEALTH-TIMEOUT only. `startApiServer`
 * allocates its own free port each call, so the retry gets a FRESH port (a boot that
 * stalled on a taken port isn't retried into the same collision). The retry is scoped
 * to the transient-pressure class the diagnosis identified — a server that came up but
 * missed the `/health` deadline under load. A deterministic failure (spawn error, early
 * exit) or a run cancellation surfaces after ONE attempt: a retry would only re-crash it
 * and burn boot budget. Returns the final boot result plus the attempts made (1 or 2).
 */
async function bootWithRetry(
  ctx: RunApiScenarioContext,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ boot: StartApiServerResult; attempts: number }> {
  const opts = {
    resolvedServe: ctx.server.resolvedServe,
    cwd,
    env,
    healthPath: ctx.server.healthPath,
    readyTimeoutMs: ctx.server.readyTimeoutMs,
    signal: ctx.signal,
  }
  const first = await startApiServer(opts)
  if (first.ok || !first.timedOut || ctx.signal?.aborted) return { boot: first, attempts: 1 }
  const second = await startApiServer(opts)
  return { boot: second, attempts: 2 }
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
 * words the dashboard's step list uses ({@link describeApiLifecycleStep}), so the
 * transcript and the UI can never describe one step two ways.
 */
function lifecycleRecord(
  index: number,
  step: GuardApiBootStep | GuardApiSignalStep | GuardApiLogsStep,
): ApiEvidenceStep {
  const described = describeApiLifecycleStep(step)
  const env = described.env ? ` (env: ${described.env.join(' ')})` : ''
  return {
    index,
    kind: isApiBootStep(step) ? 'boot' : isApiSignalStep(step) ? 'signal' : 'logs',
    action: `${described.command}${env}`,
    ...(described.expectation ? { expectation: described.expectation } : {}),
    repeat: 1,
    iterationsRun: 1,
    status: null,
    timedOut: false,
    rawBody: '',
    normBody: '',
    durationMs: 0,
  }
}

function toRecord(
  index: number,
  step: GuardApiRequestStep,
  interpolatedPath: string,
  capture: ApiStepCapture | null,
  repeat: number,
  iterationsRun: number,
  normText: (t: string) => string,
  captured: Record<string, string> | undefined,
): ApiEvidenceStep {
  return {
    index,
    kind: 'request',
    method: step.request.method,
    path: interpolatedPath,
    ...(step.request.headers ? { requestHeaders: step.request.headers } : {}),
    ...(step.request.body !== undefined
      ? { requestBody: step.request.body }
      : step.request.json !== undefined
        ? { requestBody: JSON.stringify(step.request.json) }
        : {}),
    repeat,
    iterationsRun,
    status: capture?.status ?? null,
    timedOut: capture?.timedOut ?? false,
    ...(capture?.requestError ? { requestError: capture.requestError } : {}),
    rawBody: capture?.bodyText ?? '',
    normBody: normText(capture?.bodyText ?? ''),
    durationMs: capture?.durationMs ?? 0,
    ...(captured && Object.keys(captured).length > 0 ? { captured } : {}),
  }
}
