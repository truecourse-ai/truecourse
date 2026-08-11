/**
 * The API step driver — an HTTP request against the surface the SANDBOX serves.
 *
 * Why a request step belongs in a sandbox scenario at all: driving the UI proves the
 * user can DO the thing, and reading the result back as structured data proves the
 * thing actually happened. Regexing a page for a number is a test of the page's
 * prose; `GET …/violations?severity=critical` and asserting `json total is 2` is a
 * test of the answer. So a mixed scenario acts through the browser and then asks the
 * same origin, in JSON, what the state now is.
 *
 * The SAME origin, deliberately: the server this driver requests is the sandbox's
 * shared surface (`surface.ts`) — the very one the browser is driving — started
 * lazily by whichever driver reaches it first. A scenario made only of request steps
 * therefore boots the surface exactly the way a web step does, and needs no browser.
 *
 * Everything below the seam is the api driver's own machinery, reused rather than
 * re-implemented: `executeApiRequest` sends it, `observeApiExpect` judges it (and
 * pairs every assertion with its own answer), `lookupJsonPath` captures out of it.
 * What is local to the sandbox is only the TOKEN vocabulary — `${captured:…}` and
 * friends, resolved by the same closure every other sandbox step uses, so a value a
 * cli step captured reaches a request path and a value a request captured reaches a
 * later `fill`.
 */

import type {
  GuardApiRequestStep,
  GuardApiExpect,
  GuardComparison,
  GuardHttpRequest,
  GuardJsonMatcher,
  GuardSandboxStep,
  GuardStreamMatcher,
} from '@truecourse/shared'
import { describeApiCommand, describeApiExpect, isApiRequestStep } from '@truecourse/shared'
import { CookieJar } from '../api/cookies.js'
import { executeApiRequest, type ApiStepCapture } from '../api/executor.js'
import { observeApiExpect, parseJsonBody, type ApiCheck } from '../api/expect.js'
import { captureValueToString, lookupJsonPath, JSON_PATH_MISS } from '../api/vars.js'
import { stepExcerpt, type EvidenceStep } from '../evidence.js'
import type { SandboxSurface } from './surface.js'
import type { StepDriver, StepOutcome, StepRunContext } from './types.js'

/** The `failure.expected` an infrastructure failure of a request step carries. */
const STEP_TO_RUN = 'the step to run'

/**
 * The infra message a request step earns when the repo declares no web surface. An
 * `error`, not a `fail`: nothing about the app was observed, so there is no verdict
 * to reach — the RECIPE is incomplete, and the message says exactly that.
 */
export const NO_SERVED_SURFACE_INFRA =
  'this scenario has `request` steps, but recipe.json declares no `web` block — add one ' +
  '(`web.serve` + `web.healthPath`) so the runner knows which surface to send them to'

/**
 * The infra message a request step earns for asking to validate the response against
 * an OpenAPI operation's declared schema. `expect.schema` resolves that schema from
 * the operation an API SCENARIO is bound to; a sandbox scenario binds none, so there
 * is nothing to validate against — and a schema assertion that quietly checks nothing
 * is the one outcome worse than an error.
 */
export const NO_SCHEMA_BINDING_INFRA =
  '`expect.schema` asserts conformance to the response schema of a BOUND OpenAPI operation, ' +
  'and a sandbox scenario binds none — assert the shape with `expect.json` paths instead'

export interface ApiStepDriverOptions {
  /** The sandbox's served surface, shared with the browser. See {@link SandboxSurface}. */
  served: SandboxSurface
}

/** The driver for every step that speaks HTTP to the sandbox's served surface. */
export function apiStepDriver(opts: ApiStepDriverOptions): StepDriver {
  // One jar per scenario: a login through a request step keeps its session for the
  // request steps after it, exactly as it does on the api driver. The browser has its
  // own jar — a page's session is the browser's business, not this driver's.
  const cookies = new CookieJar()

  return {
    id: 'api',
    owns: (step: GuardSandboxStep) => isApiRequestStep(step),

    // It holds a jar and nothing that must be released: the surface is the sandbox's.
    close: async () => undefined,

    async execute(step, ctx) {
      const authored = step as GuardApiRequestStep
      const resolved = resolveRequestStep(authored, ctx.tok)
      const failedToSend = (message: string): StepOutcome => ({
        status: 'error',
        records: [apiStepRecord(ctx.stepIndex, resolved, null, [], ctx.normText)],
        expected: STEP_TO_RUN,
        message,
      })

      if (!opts.served.declared) return failedToSend(NO_SERVED_SURFACE_INFRA)
      if (resolved.expect.schema === true) return failedToSend(NO_SCHEMA_BINDING_INFRA)

      const surface = await opts.served.open(ctx)
      if (!surface.ok) return failedToSend(surface.reason)
      if (ctx.signal?.aborted) return { status: 'aborted' }

      const repeat = resolved.repeat ?? 1
      let last: { capture: ApiStepCapture; checks: ApiCheck[] } | null = null

      for (let iteration = 1; iteration <= repeat; iteration++) {
        const capture = await executeApiRequest({
          baseUrl: surface.server.baseUrl,
          request: resolved.request,
          timeoutMs: ctx.stepTimeoutMs,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
          cookies,
        })
        if (ctx.signal?.aborted) return { status: 'aborted' }

        // A request that never completed is INFRASTRUCTURE: the surface was
        // health-checked before the first step, so a refused connection or a timeout
        // says the machine went away, not that the app is wrong.
        if (capture.requestError || capture.timedOut) {
          return {
            status: 'error',
            records: [
              apiStepRecord(ctx.stepIndex, resolved, capture, [], ctx.normText, undefined, repeat, iteration),
            ],
            expected: STEP_TO_RUN,
            message: capture.timedOut
              ? `request timed out after ${ctx.stepTimeoutMs}ms`
              : `request failed: ${capture.requestError}`,
          }
        }

        const { checks, mismatch } = observeApiExpect({
          expect: resolved.expect,
          status: capture.status,
          headers: capture.headers,
          bodyText: ctx.normText(capture.bodyText),
          rawBodyText: capture.bodyText,
          normalizeText: ctx.normText,
        })
        last = { capture, checks }
        if (mismatch) {
          const excerpt = stepExcerpt(capture.bodyText)
          return {
            status: 'fail',
            records: [
              apiStepRecord(ctx.stepIndex, resolved, capture, checks, ctx.normText, undefined, repeat, iteration),
            ],
            mismatch,
            // The response body is this driver's output excerpt — the cli step's
            // `stdout` in the only form an HTTP answer has, the mapping the api
            // driver's own failure excerpts already use.
            ...(excerpt ? { excerpts: { stdout: excerpt } } : {}),
          }
        }
      }

      // Unreachable for `repeat >= 1` (the schema's floor), but the type is honest.
      if (!last) return failedToSend('the step ran no iterations')

      // Captures resolve AFTER the expectation holds — a path that resolves to
      // nothing is drift evidence (the response shape changed), so it is a `fail`
      // with the body attached, never an empty value flowing on to the next step.
      const captured: Record<string, string> = {}
      for (const [name, headerName] of Object.entries(resolved.captureHeaders ?? {})) {
        const value = last.capture.headers[headerName.toLowerCase()]
        if (value === undefined) {
          return captureMiss(
            ctx,
            resolved,
            last,
            captured,
            repeat,
            `capture "${name}" from response header "${headerName}"`,
            'the response carries no such header',
          )
        }
        captured[name] = value
      }
      if (resolved.capture && Object.keys(resolved.capture).length > 0) {
        const parsed = parseJsonBody(last.capture.bodyText)
        for (const [name, jsonPath] of Object.entries(resolved.capture)) {
          const value = 'error' in parsed ? JSON_PATH_MISS : lookupJsonPath(parsed.value, jsonPath)
          if (value === JSON_PATH_MISS) {
            return captureMiss(
              ctx,
              resolved,
              last,
              captured,
              repeat,
              `capture "${name}" at json path "${jsonPath}"`,
              'error' in parsed
                ? `response body is not JSON: ${parsed.error}`
                : 'the path resolved to nothing',
            )
          }
          captured[name] = captureValueToString(value)
        }
      }
      ctx.publishCaptures(captured)

      return {
        status: 'ok',
        records: [
          apiStepRecord(ctx.stepIndex, resolved, last.capture, last.checks, ctx.normText, captured, repeat),
        ],
      }
    },
  }
}

/** A capture that resolved to nothing — the step failing, with its record attached. */
function captureMiss(
  ctx: StepRunContext,
  step: GuardApiRequestStep,
  last: { capture: ApiStepCapture; checks: ApiCheck[] },
  captured: Record<string, string>,
  repeat: number,
  expected: string,
  actual: string,
): StepOutcome {
  const excerpt = stepExcerpt(last.capture.bodyText)
  return {
    status: 'fail',
    records: [apiStepRecord(ctx.stepIndex, step, last.capture, last.checks, ctx.normText, captured, repeat)],
    mismatch: {
      subject: 'capture',
      expected,
      actual,
      detail: [`${expected} — ${actual}`, '--- response body ---', last.capture.bodyText],
    },
    ...(excerpt ? { excerpts: { stdout: excerpt } } : {}),
  }
}

/**
 * The transcript record of a request step. It spawns nothing, so it has no exit code
 * and no streams; what it has is a request line, a status, each assertion beside the
 * response's own answer to it, and the body it read. Written for a passing step and a
 * failing one alike — a green request step is only checkable with the body in front
 * of the reader.
 */
function apiStepRecord(
  index: number,
  step: GuardApiRequestStep,
  capture: ApiStepCapture | null,
  checks: readonly ApiCheck[],
  normText: (text: string) => string,
  captured?: Record<string, string>,
  repeat = 1,
  iterationsRun = repeat,
): EvidenceStep {
  const body = capture?.bodyText ?? ''
  const requestBody = requestBodyOf(step.request)
  return {
    index,
    kind: 'api',
    argv: [],
    api: {
      command: describeApiCommand(step),
      expectation: describeApiExpect(step.expect),
      ...(checks.length > 0 ? { checks } : {}),
      method: step.request.method,
      path: step.request.path,
      ...(requestBody !== undefined ? { requestBody } : {}),
      status: capture?.status ?? null,
      ...(capture?.requestError ? { requestError: capture.requestError } : {}),
      body: stepExcerpt(body) ?? '',
    },
    repeat,
    iterationsRun,
    exitCode: null,
    timedOut: capture?.timedOut ?? false,
    rawStdout: body,
    rawStderr: '',
    // Nothing arrived ⇒ nothing to normalize: a step that never got a response has
    // no body, normalized or otherwise.
    normStdout: capture ? normText(body) : '',
    normStderr: '',
    durationMs: capture?.durationMs ?? 0,
    ...(captured && Object.keys(captured).length > 0 ? { captured } : {}),
  }
}

/** The body as it went on the wire — raw text, or the serialized `json` form. */
function requestBodyOf(request: GuardHttpRequest): string | undefined {
  if (request.body !== undefined) return request.body
  return request.json !== undefined ? JSON.stringify(request.json) : undefined
}

// --- Token resolution: the sandbox's vocabulary, across a request step ------
//
// The same traversal `web/tokens.ts` performs, for the strings a REQUEST carries.
// One rule, shared with every other sandbox step: a scenario's own strings are
// interpolated, the recipe's are not — and the caller passes the very `tok` closure
// the cli and web steps use, which is what makes `${captured:…}` mean one thing
// across all three surfaces.

type Tok = (text: string) => string

/** A text matcher with every authored value resolved — the comparands included. */
function resolveMatcher(matcher: GuardStreamMatcher, tok: Tok): GuardStreamMatcher {
  return {
    ...matcher,
    ...(matcher.equals !== undefined ? { equals: tok(matcher.equals) } : {}),
    ...(matcher.contains !== undefined ? { contains: tok(matcher.contains) } : {}),
    ...(matcher.matches !== undefined ? { matches: tok(matcher.matches) } : {}),
    ...(matcher.compare ? { compare: resolveComparison(matcher.compare, tok) } : {}),
  }
}

/** A json matcher with every authored value resolved. `equals` is a JSON value: strings only. */
function resolveJsonMatcher(matcher: GuardJsonMatcher, tok: Tok): GuardJsonMatcher {
  return {
    ...matcher,
    ...(typeof matcher.equals === 'string' ? { equals: tok(matcher.equals) } : {}),
    ...(matcher.contains !== undefined ? { contains: tok(matcher.contains) } : {}),
    ...(matcher.matches !== undefined ? { matches: tok(matcher.matches) } : {}),
    ...(matcher.compare ? { compare: resolveComparison(matcher.compare, tok) } : {}),
  }
}

/** A comparison's string comparands — where `atMost: "${captured:estimate}"` lives. */
function resolveComparison(compare: GuardComparison, tok: Tok): GuardComparison {
  return {
    ...compare,
    ...(typeof compare.equals === 'string' ? { equals: tok(compare.equals) } : {}),
    ...(typeof compare.atMost === 'string' ? { atMost: tok(compare.atMost) } : {}),
    ...(typeof compare.atLeast === 'string' ? { atLeast: tok(compare.atLeast) } : {}),
  }
}

/** An api expectation with every authored string resolved. */
function resolveApiExpect(expect: GuardApiExpect, tok: Tok): GuardApiExpect {
  return {
    ...expect,
    ...(expect.headers
      ? {
          headers: Object.fromEntries(
            Object.entries(expect.headers).map(([name, m]) => [name, resolveMatcher(m, tok)]),
          ),
        }
      : {}),
    ...(expect.body ? { body: resolveMatcher(expect.body, tok) } : {}),
    ...(expect.json
      ? {
          json: Object.fromEntries(
            // The PATH is authored too: a scenario can address `items[${captured:i}]`.
            Object.entries(expect.json).map(([path, m]) => [tok(path), resolveJsonMatcher(m, tok)]),
          ),
        }
      : {}),
  }
}

/** Every string a JSON request body carries — keys included, as `capturedNamesIn` walks them. */
function resolveJsonValue(value: unknown, tok: Tok): unknown {
  if (typeof value === 'string') return tok(value)
  if (Array.isArray(value)) return value.map((item) => resolveJsonValue(item, tok))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [tok(k), resolveJsonValue(v, tok)]),
    )
  }
  return value
}

/**
 * The step the driver actually sends: every authored string with its tokens
 * substituted, so the request, the assertion, the transcript and the failure message
 * all quote the RESOLVED text a reader can act on.
 */
export function resolveRequestStep(step: GuardApiRequestStep, tok: Tok): GuardApiRequestStep {
  return {
    ...step,
    request: {
      ...step.request,
      path: tok(step.request.path),
      ...(step.request.headers
        ? {
            headers: Object.fromEntries(
              Object.entries(step.request.headers).map(([name, value]) => [name, tok(value)]),
            ),
          }
        : {}),
      ...(step.request.body !== undefined ? { body: tok(step.request.body) } : {}),
      ...(step.request.json !== undefined ? { json: resolveJsonValue(step.request.json, tok) } : {}),
    },
    expect: resolveApiExpect(step.expect, tok),
  }
}
