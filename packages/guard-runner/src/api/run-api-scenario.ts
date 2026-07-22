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
import { createSandbox, SandboxError, DETERMINISM_PINS } from '../sandbox.js'
import { applyCapabilities, CapabilityError } from '../capabilities/index.js'
import { normalize, type NormalizerContext } from '../normalizers.js'
import { SANDBOX_SETUP_EXPECTED, CAPABILITY_SETUP_EXPECTED, FAILURE_OUTPUT_LIMIT } from '../run-scenario.js'
import { startApiServer, type ApiServerHandle } from './server.js'
import { executeApiRequest, type ApiStepCapture } from './executor.js'
import { evaluateApiExpect, parseJsonBody } from './expect.js'
import {
  interpolateRequest,
  lookupJsonPath,
  captureValueToString,
  UnknownVariableError,
  UnknownCredentialError,
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
  stepTimeoutMs: number
  signal?: AbortSignal
  capturePassEvidence: boolean
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
  const base = {
    id: scenario.id,
    title: scenario.title,
    binds: scenario.binds,
  }
  const credentials = ctx.credentials ?? new Map<string, string>()
  const redact = buildCredentialRedactor(credentials)

  let sandbox
  try {
    sandbox = createSandbox({
      recipeEnv: ctx.recipeEnv,
      scenarioEnv: scenario.setup?.env,
      setupFiles: scenario.setup?.files,
    })
  } catch (e) {
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

    // Boot the server in the sandbox — fresh state dir + fresh port per scenario.
    const boot = await startApiServer({
      resolvedServe: ctx.resolvedServe,
      cwd: sandbox.cwd,
      env: sandbox.env,
      healthPath: ctx.healthPath,
      readyTimeoutMs: ctx.readyTimeoutMs,
      signal: ctx.signal,
    })
    if (ctx.signal?.aborted) return abortedResult(base, 1, start)
    if (!boot.ok) {
      return {
        ...base,
        outcome: 'error',
        durationMs: Date.now() - start,
        failure: {
          step: 1,
          expected: 'the api server to start',
          actual: boot.reason,
          ...(boot.stdout ? { stdout: redact(boot.stdout.slice(-FAILURE_OUTPUT_LIMIT)) } : {}),
          ...(boot.stderr ? { stderr: redact(boot.stderr.slice(-FAILURE_OUTPUT_LIMIT)) } : {}),
        },
      }
    }
    server = boot.server

    const vars = new Map<string, string>()

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]
      const stepIndex = i + 1
      const repeat = step.repeat ?? 1

      for (let iteration = 1; iteration <= repeat; iteration++) {
        if (ctx.signal?.aborted) return abortedResult(base, stepIndex, start)

        // One credential-aware pass: `${var}` interpolation plus `{{cred:name}}`
        // header substitution. An unknown `${var}` is an authoring defect the birth
        // retry can fix from the message — a `fail`, not infrastructure; a
        // `{{cred:name}}` the recipe never declared is a scenario-level `error`
        // surfaced loudly, never a silent pass.
        let request
        try {
          request = interpolateRequest(step.request, vars, credentials)
        } catch (e) {
          if (e instanceof UnknownVariableError) {
            records.push(toRecord(stepIndex, step, step.request.path, null, repeat, iteration, normText, undefined))
            return failResult(base, scenario, ctx, sandbox.cwd, server, records, stepIndex, start, {
              expected: `\${${e.variable}} to be captured by an earlier step`,
              actual: e.message,
            }, null, redact)
          }
          if (e instanceof UnknownCredentialError) {
            return {
              ...base,
              outcome: 'error',
              durationMs: Date.now() - start,
              failure: {
                step: stepIndex,
                expected: `credential "${e.credential}" to be declared in the recipe's api.credentials`,
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
            binds: scenario.binds,
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
            failure: { step: stepIndex, expected: 'the request to complete', actual: infra, ...apiExcerpts(capture, server, redact) },
            evidencePath,
          }
        }

        const normBody = normText(capture.bodyText)
        const mismatch = evaluateApiExpect({
          expect: step.expect,
          status: capture.status,
          headers: capture.headers,
          bodyText: normBody,
          rawBodyText: capture.bodyText,
          normalizeText: normText,
        })
        if (mismatch) {
          records.push(toRecord(stepIndex, step, request.path, capture, repeat, iteration, normText, undefined))
          return failResult(base, scenario, ctx, sandbox.cwd, server, records, stepIndex, start, mismatch, capture, redact)
        }

        // Captures resolve AFTER the expectation holds; a path that resolves to
        // nothing is drift evidence (the response shape changed) — a `fail`.
        let captured: Record<string, string> | undefined
        if (step.capture && Object.keys(step.capture).length > 0) {
          const parsed = parseJsonBody(capture.bodyText)
          captured = {}
          for (const [name, jsonPath] of Object.entries(step.capture)) {
            const value = 'error' in parsed ? JSON_PATH_MISS : lookupJsonPath(parsed.value, jsonPath)
            if (value === JSON_PATH_MISS) {
              records.push(toRecord(stepIndex, step, request.path, capture, repeat, iteration, normText, captured))
              return failResult(base, scenario, ctx, sandbox.cwd, server, records, stepIndex, start, {
                expected: `capture "${name}" at json path "${jsonPath}"`,
                actual:
                  'error' in parsed
                    ? `response body is not JSON: ${parsed.error}`
                    : 'the path resolved to nothing',
              }, capture, redact)
            }
            const str = captureValueToString(value)
            captured[name] = str
            vars.set(name, str)
          }
        }

        if (iteration === repeat) {
          records.push(toRecord(stepIndex, step, request.path, capture, repeat, iteration, normText, captured))
        }
      }
    }

    const evidencePath = ctx.capturePassEvidence
      ? writeApiEvidence({
          repoRoot: ctx.repoRoot,
          runId: ctx.runId,
          scenarioId: scenario.id,
          title: scenario.title,
          binds: scenario.binds,
          outcome: 'pass',
          steps: records,
          sandboxCwd: sandbox.cwd,
          envPins: ENV_PINS,
          serverLogs: server.logs(),
          redact,
        })
      : undefined
    return { ...base, outcome: 'pass', durationMs: Date.now() - start, ...(evidencePath ? { evidencePath } : {}) }
  } finally {
    await server?.stop()
    sandbox.cleanup()
  }
}

/** Settle a `fail` with its evidence bundle (shared by expect, var, and capture misses). */
function failResult(
  base: Pick<GuardScenarioResult, 'id' | 'title' | 'binds'>,
  scenario: GuardApiScenario,
  ctx: RunApiScenarioContext,
  sandboxCwd: string,
  server: ApiServerHandle,
  records: ApiEvidenceStep[],
  stepIndex: number,
  start: number,
  mismatch: { expected: string; actual: string; subject?: string; detail?: string[] },
  capture: ApiStepCapture | null,
  redact: (t: string) => string,
): GuardScenarioResult {
  const evidencePath = writeApiEvidence({
    repoRoot: ctx.repoRoot,
    runId: ctx.runId,
    scenarioId: scenario.id,
    title: scenario.title,
    binds: scenario.binds,
    outcome: 'fail',
    steps: records,
    failingStep: stepIndex,
    mismatch: {
      subject: (mismatch.subject ?? 'json') as 'status' | 'headers' | 'body' | 'json',
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
    failure: {
      step: stepIndex,
      expected: redact(mismatch.expected),
      actual: redact(mismatch.actual),
      ...apiExcerpts(capture, server, redact),
    },
    evidencePath,
  }
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
