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
  GuardApiStep,
  GuardScenarioResult,
  OutputExcerpts,
} from '@truecourse/shared'
import { blockedPreconditionAnnotation } from '@truecourse/shared'
import { createSandbox, SandboxError, DETERMINISM_PINS } from '../sandbox.js'
import { applyCapabilities, CapabilityError } from '../capabilities/index.js'
import { startHttpStubs, applyHttpStubOrigins, type HttpStubsHandle } from '../capabilities/http.js'
import { normalize, type NormalizerContext } from '../normalizers.js'
import { applyUniqueSetup } from '../unique.js'
import { SANDBOX_SETUP_EXPECTED, CAPABILITY_SETUP_EXPECTED, FAILURE_OUTPUT_LIMIT } from '../run-scenario.js'
import { startApiServer, type ApiServerHandle, type StartApiServerResult } from './server.js'
import { executeApiRequest, type ApiStepCapture } from './executor.js'
import { CookieJar } from './cookies.js'
import { evaluateApiExpect, parseJsonBody } from './expect.js'
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

export interface RunApiScenarioContext {
  repoRoot: string
  runId: string
  /** Absolute-resolved serve argv (see `resolveEntry`). */
  resolvedServe: string[]
  /** Health path + ready budget from the recipe's api block (defaults applied). */
  healthPath: string
  readyTimeoutMs: number
  /** Recipe-level env merged with the api block's env (api wins). */
  recipeEnv?: Record<string, string>
  /**
   * Resolved api credentials (name → secret value) the runner injects into steps
   * referencing `{{cred:<name>}}`. The same values are masked back out of evidence
   * and failure output. Absent/empty ⇒ no substitution and no redaction.
   */
  credentials?: ReadonlyMap<string, string>
  /**
   * Secret env values of the PROVIDED external API accounts (item 62), keyed
   * `<service>.<VAR>`. NOT injectable into steps (the app consumes them, not the
   * scenario) — they exist here for ONE reason: they join the redactor, so an
   * upstream key the app forwards can never land in an evidence transcript.
   */
  externalSecrets?: ReadonlyMap<string, string>
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
  step: GuardApiStep,
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

/** The failing-step excerpts: response body as `stdout`, server stderr as `stderr`. */
function apiExcerpts(
  capture: ApiStepCapture | null,
  server: ApiServerHandle | null,
  redact: (t: string) => string,
): OutputExcerpts {
  const out: OutputExcerpts = {}
  if (capture?.bodyText) out.stdout = redact(capture.bodyText.slice(0, FAILURE_OUTPUT_LIMIT))
  const stderr = server?.logs().stderr
  if (stderr) out.stderr = redact(stderr.slice(-FAILURE_OUTPUT_LIMIT))
  return out
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
  let setup = declaredSetup
  try {
    stubs = await startHttpStubs(declaredSetup?.http)
    if (stubs) setup = applyHttpStubOrigins(declaredSetup, stubs.origins)
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
  const records: ApiEvidenceStep[] = []
  let server: ApiServerHandle | null = null

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

    // Boot the server in the sandbox — fresh state dir + fresh port per scenario.
    // A failed boot is retried ONCE (fresh port — `startApiServer` allocates its own
    // each call): the diagnosed cal.com failure was transient host pressure that a lone
    // retry clears. A recipe/env defect (missing credential env, undeclared fixture)
    // fires BEFORE the boot, so it never reaches this retry and never wastes an attempt.
    const { boot, attempts } = await bootWithRetry(ctx, sandbox.cwd, sandbox.env)
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
    // Success-after-retry is recorded on every downstream outcome (pass/fail/error),
    // so a scenario that only came up on the second boot is never silent.
    const bootAttempts = attempts > 1 ? attempts : undefined

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

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]
      const stepIndex = i + 1
      // Attribute any stub violation raised while this step runs to THIS step.
      stubs?.markStep(stepIndex)
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
            return failResult(base, scenario, ctx, sandbox.cwd, server, records, stepIndex, step.milestone, start, {
              expected: `\${${e.variable}} to be captured by an earlier step`,
              actual: e.message,
            }, null, redact, bootAttempts)
          }
          if (e instanceof UnknownCredentialError) {
            return {
              ...base,
              outcome: 'error',
              durationMs: Date.now() - start,
              ...(bootAttempts ? { bootAttempts } : {}),
              ...(step.milestone ? { failedMilestone: step.milestone } : {}),
              failure: {
                step: stepIndex,
                expected: `credential "${e.credential}" to be declared in the recipe's api.credentials`,
                actual: e.message,
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
            serverLogs: server.logs(),
            redact,
          })
          return {
            ...base,
            outcome: 'error',
            durationMs: Date.now() - start,
            ...(bootAttempts ? { bootAttempts } : {}),
            ...(step.milestone ? { failedMilestone: step.milestone } : {}),
            failure: { step: stepIndex, expected: 'the request to complete', actual: infra, ...apiExcerpts(capture, server, redact) },
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
          return failResult(base, scenario, ctx, sandbox.cwd, server, records, stepIndex, step.milestone, start, mismatch, capture, redact, bootAttempts)
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
              return failResult(base, scenario, ctx, sandbox.cwd, server, records, stepIndex, step.milestone, start, {
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
              return failResult(base, scenario, ctx, sandbox.cwd, server, records, stepIndex, step.milestone, start, {
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
        server,
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
          serverLogs: server.logs(),
          redact,
        })
      : undefined
    return { ...base, outcome: 'pass', durationMs: Date.now() - start, ...(bootAttempts ? { bootAttempts } : {}), ...(evidencePath ? { evidencePath } : {}) }
  } finally {
    await server?.stop()
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
  server: ApiServerHandle,
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
      subject: (mismatch.subject ?? 'json') as 'status' | 'headers' | 'body' | 'schema' | 'json' | 'stub',
      expected: mismatch.expected,
      actual: mismatch.actual,
      detail: mismatch.detail ?? [`expected: ${mismatch.expected}`, `actual:   ${mismatch.actual}`],
    },
    sandboxCwd,
    envPins: ENV_PINS,
    serverLogs: server.logs(),
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
      ...apiExcerpts(capture, server, redact),
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
    resolvedServe: ctx.resolvedServe,
    cwd,
    env,
    healthPath: ctx.healthPath,
    readyTimeoutMs: ctx.readyTimeoutMs,
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

function toRecord(
  index: number,
  step: GuardApiStep,
  interpolatedPath: string,
  capture: ApiStepCapture | null,
  repeat: number,
  iterationsRun: number,
  normText: (t: string) => string,
  captured: Record<string, string> | undefined,
): ApiEvidenceStep {
  return {
    index,
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
