/**
 * The API driver's verb vocabulary — the per-driver closed sub-schema the driver
 * registry (`drivers.ts`) describes, in its own module because a driver's verbs are
 * its own business: the scenario ENVELOPE is frozen across drivers, and only this
 * grows.
 *
 * The driver boots the recipe's HTTP server and drives it with `request` steps,
 * with `expect` matchers on status, headers, body text, and JSON paths — plus the
 * process-lifecycle steps `boot` / `signal` / `logs`, which make startup,
 * configuration, shutdown, logging and restart-persistence claims assertable on the
 * same surface.
 */

import { z } from 'zod'
import { GuardComparisonSchema, describeComparison } from './capture.js'
import {
  GuardStreamMatcherSchema,
  describeStreamMatcher,
  matcherPatterns,
  stepMilestone as milestone,
} from './step-parts.js'

// --- Steps (api driver) ----------------------------------------------

/** The closed HTTP method set an api step may use. */
export const GUARD_HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const

/**
 * One HTTP request against the recipe's booted server. `path` (and header/body
 * string values) may reference earlier `capture`s as `${name}`; the engine
 * interpolates before sending. Exactly one body form: `body` (raw text, sent
 * as-is) or `json` (a JSON value, serialized with `content-type: application/json`).
 */
export const GuardHttpRequestSchema = z
  .object({
    method: z.enum(GUARD_HTTP_METHODS),
    /** Request path incl. query, e.g. `/todos/${id}?full=1`. Must start with `/`. */
    path: z.string().regex(/^\//, 'path must start with /'),
    headers: z.record(z.string(), z.string()).optional(),
    /** Raw request body, sent byte-for-byte. */
    body: z.string().optional(),
    /** JSON request body; serialized and sent with `content-type: application/json`. */
    json: z.unknown().optional(),
  })
  .strict()
  .refine((r) => r.body === undefined || r.json === undefined, {
    message: 'a request carries `body` or `json`, not both',
  })

/**
 * Matcher on the value at one JSON path of the response body. `equals` compares
 * the JSON value (scalars compared strictly; objects/arrays structurally);
 * `contains`/`matches` compare against the value's string form.
 */
export const GuardJsonMatcherSchema = z
  .object({
    equals: z.unknown().optional(),
    contains: z.string().optional(),
    /** Regex source; matched with `RegExp(pattern).test(String(value))`. */
    matches: z.string().optional(),
    exists: z.boolean().optional(),
    absent: z.boolean().optional(),
    /**
     * A NUMERIC comparison on the value at this path — the json subject's half of
     * the captured-value vocabulary. The value is usually already a number, so
     * `compare.number` is rarely needed here. See {@link GuardComparisonSchema}.
     */
    compare: GuardComparisonSchema.optional(),
  })
  .strict()
  .refine(
    (m) =>
      m.equals !== undefined ||
      m.contains !== undefined ||
      m.matches !== undefined ||
      m.exists !== undefined ||
      m.absent !== undefined ||
      m.compare !== undefined,
    { message: 'json matcher needs one of equals | contains | matches | exists | absent | compare' },
  )

export const GuardApiExpectSchema = z
  .object({
    /** Exact HTTP status code. */
    status: z.number().int().optional(),
    /** Header name (case-insensitive) → matcher on its value. */
    headers: z.record(z.string(), GuardStreamMatcherSchema).optional(),
    /** Matcher on the raw response body text, compared post-normalization. */
    body: GuardStreamMatcherSchema.optional(),
    /** JSON path (`a.b[0].c`, `""` for the root) → matcher on the value there. */
    json: z.record(z.string(), GuardJsonMatcherSchema).optional(),
    /**
     * Response-schema conformance (B5): `true` asserts the whole response body
     * conforms to the JSON response schema the BOUND OpenAPI operation declares for
     * this step's `expect.status`. A bare boolean, not an anchor — the runner resolves
     * the schema from the bound operation at run time (freshness comes from the stale
     * gate). Requires the scenario to bind to an OpenAPI operation that declares a JSON
     * response schema for the asserted status, else the scenario errors (never a silent
     * pass). Additive — no GUARD_FORMAT_VERSION bump; old scenarios parse unchanged.
     */
    schema: z.boolean().optional(),
  })
  .strict()

export const GuardApiRequestStepSchema = z
  .object({
    request: GuardHttpRequestSchema,
    /**
     * Variable name → JSON path into THIS step's response body. Captured values
     * are available to later steps as `${name}` in path/header/body strings.
     * A path that resolves to nothing fails the step.
     */
    capture: z.record(z.string(), z.string()).optional(),
    /**
     * Variable name → RESPONSE HEADER name (case-insensitive) on THIS step's
     * response. The sibling of {@link GuardApiRequestStepSchema}.capture for everything
     * that rides a header rather than the body: `x-auth-token`, an `ETag`, or the
     * `Location` of a 3xx (the runner never follows redirects, so the redirect
     * target IS observable). Captured values join the same `${name}` namespace as
     * body captures — one name has one source — and a header the response does not
     * carry fails the step exactly like a body path that resolves to nothing.
     * `Set-Cookie` needs no capture: the per-scenario cookie jar replays session
     * cookies onto later steps automatically.
     */
    captureHeaders: z.record(z.string(), z.string()).optional(),
    /** Run the step N times; every iteration must satisfy `expect`. Default 1. */
    repeat: z.number().int().positive().optional(),
    expect: GuardApiExpectSchema,
    /** The flow milestone this step realizes. See {@link milestone}. */
    milestone,
  })
  .strict()

// --- Steps (api driver) — the SERVER PROCESS lifecycle ---------------

/**
 * What a `boot` step asserts about the process it starts. `ready: true` (the
 * default when `expect` is omitted) means the server must become HEALTHY — the
 * implicit boot every api scenario has always done, now sayable. `exitCode` /
 * `stderrContains` mean the opposite: the process must EXIT within the recipe's
 * ready budget, which is how "an invalid configuration fails startup with a
 * non-zero exit code and a descriptive error" is asserted. The two are mutually
 * exclusive — a process cannot both serve traffic and be dead.
 */
export const GuardBootExpectSchema = z
  .object({
    /** The server must answer the recipe's health path with 2xx. */
    ready: z.literal(true).optional(),
    /** The process must exit with exactly this code. */
    exitCode: z.number().int().optional(),
    /** Substrings that must ALL appear in what the exiting process wrote to stderr. */
    stderrContains: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine(
    (e) => e.ready !== undefined || e.exitCode !== undefined || e.stderrContains !== undefined,
    { message: 'boot expectation needs one of ready | exitCode | stderrContains' },
  )
  .refine((e) => e.ready === undefined || (e.exitCode === undefined && e.stderrContains === undefined), {
    message: 'a boot expects `ready` OR an exit (`exitCode`/`stderrContains`), never both',
  })

/**
 * (Re)start the server process under test. A scenario with NO `boot` step keeps
 * the implicit boot the api driver has always done, so every existing scenario is
 * unchanged; a scenario that carries one owns its own lifecycle from the first
 * step on. `env` layers OVER the recipe's env and the scenario's `setup.env` for
 * THIS boot only — the world-state channel a claim about configuration needs —
 * and every boot allocates a FRESH port, so `${PORT}` in the serve argv/env
 * resolves per boot exactly as it does for the implicit one.
 */
export const GuardBootSchema = z
  .object({
    /**
     * Env overlay for this boot only (last layer wins over `setup.env`).
     * `${unique}` and `${HTTP_STUB:<name>}` resolve in the values, as in `setup.env`.
     * There is no removal channel: a variable the recipe sets is always set.
     */
    env: z.record(z.string(), z.string()).optional(),
    /** What the boot must do. Omitted ⇒ `{ ready: true }`. */
    expect: GuardBootExpectSchema.optional(),
  })
  .strict()

/** The signals a scenario may send the running server. */
export const GUARD_PROCESS_SIGNALS = ['SIGTERM', 'SIGINT'] as const

/**
 * Send a signal to the RUNNING server process and, optionally, assert how it
 * goes down — the graceful-shutdown claim ("exits with code 0 on SIGTERM"). With
 * no `expect` the step only delivers the signal (the first half of a restart).
 */
export const GuardSignalSchema = z
  .object({
    name: z.enum(GUARD_PROCESS_SIGNALS),
    expect: z
      .object({
        /** The process must exit with exactly this code (a signal-killed process has none). */
        exitCode: z.number().int().optional(),
        /** Budget for the exit; a default is applied when omitted. */
        withinMs: z.number().int().positive().max(600_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

/** A log-line matcher: a plain substring, or `{ pattern }` as a regex source. */
export const GuardLogMatchSchema = z.union([
  z.string().min(1),
  z.object({ pattern: z.string().min(1) }).strict(),
])

/**
 * Assert on what the server process WROTE. The runner already captures the
 * server's stdout/stderr for evidence; this reads that buffer, per LINE, so
 * "one stdout log line per request, carrying method, path, status and duration"
 * is a first-class assertion instead of an invisible behavior.
 *
 * `sinceLastStep` narrows the window to output that arrived after the previous
 * step began — the way a log line is attributed to the request that caused it.
 * Output is matched RAW: `normalize` deliberately does not apply, because the
 * volatile parts (a duration, a timestamp) are often the very thing a claim is
 * about. The buffer spans the whole scenario, so a restart's earlier output is
 * still readable after the second boot.
 */
export const GuardLogsSchema = z
  .object({
    stream: z.enum(['stdout', 'stderr']),
    match: GuardLogMatchSchema,
    /** Match only output that arrived after the previous step began. Default false. */
    sinceLastStep: z.boolean().optional(),
    /**
     * Exact number of matching LINES in the window. Omitted ⇒ at least one.
     * `0` asserts no line has matched (checked immediately, with no wait).
     */
    count: z.number().int().nonnegative().optional(),
    /** How long to wait for the expected lines to appear; a default is applied. */
    withinMs: z.number().int().positive().max(600_000).optional(),
  })
  .strict()

export const GuardApiBootStepSchema = z
  .object({ boot: GuardBootSchema, milestone })
  .strict()

export const GuardApiSignalStepSchema = z
  .object({ signal: GuardSignalSchema, milestone })
  .strict()

export const GuardApiLogsStepSchema = z
  .object({ logs: GuardLogsSchema, milestone })
  .strict()

/**
 * ONE api step — one action. A `request` drives the server over HTTP; `boot`,
 * `signal` and `logs` drive and observe the server PROCESS, which is what makes
 * startup, configuration, shutdown, logging and restart-persistence claims
 * testable on this surface. All three are additive and optional: no
 * `GUARD_FORMAT_VERSION` bump, and a scenario made only of `request` steps parses
 * and runs exactly as it did before.
 */
export const GuardApiStepSchema = z.union([
  GuardApiRequestStepSchema,
  GuardApiBootStepSchema,
  GuardApiSignalStepSchema,
  GuardApiLogsStepSchema,
])

/** True when the step drives the server over HTTP (the original step kind). */
export function isApiRequestStep(step: GuardApiStep): step is GuardApiRequestStep {
  return 'request' in step
}

/** True when the step (re)starts the server process. */
export function isApiBootStep(step: GuardApiStep): step is GuardApiBootStep {
  return 'boot' in step
}

/** True when the step signals the running server process. */
export function isApiSignalStep(step: GuardApiStep): step is GuardApiSignalStep {
  return 'signal' in step
}

/** True when the step asserts on the server process's captured output. */
export function isApiLogsStep(step: GuardApiStep): step is GuardApiLogsStep {
  return 'logs' in step
}

// --- Presentation: what an api step DOES and ASSERTS -------------------

export function describeJsonMatcher(m: GuardJsonMatcher): string {
  if (m.exists) return 'exists'
  if (m.absent) return 'is absent'
  if (m.equals !== undefined) return `is ${JSON.stringify(m.equals)}`
  if (m.contains !== undefined) return `contains “${m.contains}”`
  if (m.matches !== undefined) return `matches /${m.matches}/`
  return describeComparison(m.compare!)
}

export function describeApiExpect(expect: GuardApiExpect): string {
  const parts: string[] = []
  if (expect.status !== undefined) parts.push(`status ${expect.status}`)
  for (const [name, m] of Object.entries(expect.headers ?? {})) {
    parts.push(`${name} ${describeStreamMatcher(m)}`)
  }
  if (expect.body) parts.push(`body ${describeStreamMatcher(expect.body)}`)
  for (const [path, m] of Object.entries(expect.json ?? {})) {
    parts.push(`${path || '$'} ${describeJsonMatcher(m)}`)
  }
  if (expect.schema) parts.push('matches the declared response schema')
  return parts.join(' · ')
}

/** `“x”` / `/x/` — one log-line matcher, in the words a reader needs. */
export function describeLogMatch(m: GuardLogMatch): string {
  return typeof m === 'string' ? `“${m}”` : `/${m.pattern}/`
}

/**
 * One lifecycle step as a command + expectation pair — the SINGLE rendering both
 * the dashboard step list and the runner's evidence transcript use, so the two can
 * never describe the same step differently.
 */
export function describeApiLifecycleStep(
  step: GuardApiBootStep | GuardApiSignalStep | GuardApiLogsStep,
): { command: string; expectation: string; env?: string[] } {
  if (isApiBootStep(step)) {
    const env = Object.entries(step.boot.env ?? {}).map(([k, v]) => `${k}=${v}`)
    const e = step.boot.expect
    const parts: string[] = []
    if (!e || e.ready) parts.push('becomes healthy')
    if (e?.exitCode !== undefined) parts.push(`exits ${e.exitCode}`)
    if (e?.stderrContains) parts.push(...e.stderrContains.map((s) => `stderr contains “${s}”`))
    return { command: 'boot the server', expectation: parts.join(' · '), ...(env.length > 0 ? { env } : {}) }
  }
  if (isApiSignalStep(step)) {
    const parts: string[] = []
    if (step.signal.expect?.exitCode !== undefined) parts.push(`exits ${step.signal.expect.exitCode}`)
    if (step.signal.expect?.withinMs !== undefined) parts.push(`within ${step.signal.expect.withinMs}ms`)
    return { command: `signal ${step.signal.name}`, expectation: parts.join(' · ') }
  }
  const { stream, match, count, sinceLastStep } = step.logs
  const window = sinceLastStep ? ' since the previous step' : ''
  const n = count === undefined ? 'a line' : `exactly ${count} line${count === 1 ? '' : 's'}`
  return {
    command: `read server ${stream}`,
    expectation: `${n} matching ${describeLogMatch(match)}${window}`,
  }
}
export type GuardHttpMethod = (typeof GUARD_HTTP_METHODS)[number]
export type GuardHttpRequest = z.infer<typeof GuardHttpRequestSchema>
export type GuardJsonMatcher = z.infer<typeof GuardJsonMatcherSchema>
export type GuardApiExpect = z.infer<typeof GuardApiExpectSchema>
export type GuardApiRequestStep = z.infer<typeof GuardApiRequestStepSchema>
export type GuardBootExpect = z.infer<typeof GuardBootExpectSchema>
export type GuardBoot = z.infer<typeof GuardBootSchema>
export type GuardProcessSignal = (typeof GUARD_PROCESS_SIGNALS)[number]
export type GuardSignal = z.infer<typeof GuardSignalSchema>
export type GuardLogMatch = z.infer<typeof GuardLogMatchSchema>
export type GuardLogs = z.infer<typeof GuardLogsSchema>
export type GuardApiBootStep = z.infer<typeof GuardApiBootStepSchema>
export type GuardApiSignalStep = z.infer<typeof GuardApiSignalStepSchema>
export type GuardApiLogsStep = z.infer<typeof GuardApiLogsStepSchema>
export type GuardApiStep = z.infer<typeof GuardApiStepSchema>

// --- Cross-step passes, the api driver's half --------------------------

/** Every regex source an api step carries, with the path that names it. */
export function apiStepPatterns(step: GuardApiStep): Array<{ where: string; pattern: string }> {
  if (isApiRequestStep(step)) {
    return [
      ...(step.expect.body ? matcherPatterns('expect.body', step.expect.body) : []),
      ...Object.entries(step.expect.headers ?? {}).flatMap(([name, m]) =>
        matcherPatterns(`expect.headers.${name}`, m),
      ),
      ...Object.entries(step.expect.json ?? {}).flatMap(([path, m]) =>
        matcherPatterns(`expect.json.${path || '(root)'}`, m),
      ),
    ]
  }
  if (isApiLogsStep(step) && typeof step.logs.match !== 'string') {
    return [{ where: 'logs.match', pattern: step.logs.match.pattern }]
  }
  return []
}

/**
 * The capture names one api step assigns, in declaration order. The two channels
 * (`capture` from the body, `captureHeaders` from a header) share one namespace, so
 * one name has exactly one source.
 */
export function apiStepCaptureNames(step: GuardApiStep): string[] {
  if (!isApiRequestStep(step)) return []
  return [...Object.keys(step.capture ?? {}), ...Object.keys(step.captureHeaders ?? {})]
}
