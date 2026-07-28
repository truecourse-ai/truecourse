/**
 * Guard scenario format v2 — the committed, declarative test that realizes ONE
 * spec flow on ONE surface. One YAML file per scenario under
 * `.truecourse/scenarios/<area>/`.
 *
 * A scenario is the executable product of a FLOW (spec-side: what to test) and a
 * JOURNEY path (code-side: how to test it): assertions come from the flow's spec
 * claims, steps from the journey, the driver from the journey's surface. It
 * carries `flow` (id + fingerprint), `journey` (the realization path + its
 * fingerprints), and the flow's section bindings DENORMALIZED into `binds`, so the
 * runner resolves staleness with no flow lookup. Hand-written scenarios omit
 * `flow`/`journey` and group under the Manual pseudo-flow.
 *
 * Ids are `<flow-id>.<surface>.<n>`.
 *
 * The envelope (`guard`, `id`, `title`, `flow`, `journey`, `binds`, `driver`,
 * `setup`, `steps`, `normalize`) is frozen across drivers; only the per-driver
 * verb sub-schema (keyed by `driver`) grows. The `cli` driver runs a `run` argv
 * appended to the recipe entrypoint, with `expect` matchers on exit code,
 * streams, and files. The `api` driver boots the recipe's HTTP server and drives
 * it with `request` steps, with `expect` matchers on status, headers, body text,
 * and JSON paths. Every step MAY carry the `milestone` it realizes.
 */

import { z } from 'zod'

/** Scenario format version carried in every file and echoed into the run store. */
export const GUARD_FORMAT_VERSION = 2

// --- Stream & file matchers -----------------------------------------

/** Stream (stdout/stderr) matcher — one of the three, compared post-normalization. */
export const GuardStreamMatcherSchema = z
  .object({
    equals: z.string().optional(),
    contains: z.string().optional(),
    /** Regex source; matched with `RegExp(pattern).test(stream)`. */
    matches: z.string().optional(),
  })
  .strict()
  .refine(
    (m) => m.equals !== undefined || m.contains !== undefined || m.matches !== undefined,
    { message: 'stream matcher needs one of equals | contains | matches' },
  )

/** File matcher — presence or content of a path under the sandbox cwd. */
export const GuardFileMatcherSchema = z
  .object({
    exists: z.boolean().optional(),
    absent: z.boolean().optional(),
    equals: z.string().optional(),
    contains: z.string().optional(),
  })
  .strict()
  .refine(
    (m) =>
      m.exists !== undefined ||
      m.absent !== undefined ||
      m.equals !== undefined ||
      m.contains !== undefined,
    { message: 'file matcher needs one of exists | absent | equals | contains' },
  )

export const GuardExpectSchema = z
  .object({
    exit: z.number().int().optional(),
    stdout: GuardStreamMatcherSchema.optional(),
    stderr: GuardStreamMatcherSchema.optional(),
    /** Sandbox-relative path → matcher. */
    files: z.record(z.string(), GuardFileMatcherSchema).optional(),
  })
  .strict()

// --- Milestone attribution (every driver's steps) --------------------

/**
 * The flow milestone (its `order`) a step realizes. Authoring emits it; the engine
 * validates every milestone is realized by at least one step. A step with no
 * milestone is plumbing (login, seeding) and paints neutral in a flow instance.
 */
const milestone = z.number().int().positive().optional()

// --- Steps (cli driver) ----------------------------------------------

export const GuardStepSchema = z
  .object({
    /** Argv appended to the recipe entrypoint. May be empty (run the bare entry). */
    run: z.array(z.string()),
    stdin: z.string().optional(),
    /**
     * Env overlay for THIS step's child process only, applied on top of the
     * scenario-global `setup.env` (last layer wins). Sibling steps are unaffected,
     * so one scenario can observe the same command under several environments —
     * the world-state a claim like "prints `disabled` when `X=0`" needs. `cli` only:
     * an api step drives a server whose env is fixed at boot.
     */
    env: z.record(z.string(), z.string()).optional(),
    /** Run the step N times; every iteration must satisfy `expect`. Default 1. */
    repeat: z.number().int().positive().optional(),
    expect: GuardExpectSchema,
    /** The flow milestone this step realizes. See {@link milestone}. */
    milestone,
  })
  .strict()

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
  })
  .strict()
  .refine(
    (m) =>
      m.equals !== undefined ||
      m.contains !== undefined ||
      m.matches !== undefined ||
      m.exists !== undefined ||
      m.absent !== undefined,
    { message: 'json matcher needs one of equals | contains | matches | exists | absent' },
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

export const GuardApiStepSchema = z
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
     * response. The sibling of {@link GuardApiStepSchema}.capture for everything
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

// --- The closed normalizer set --------------------------------------

export const GuardNormalizerSchema = z.enum([
  'timestamps',
  'abs-paths',
  'versions',
  'durations',
])

// --- Setup capabilities (world-state vocabulary) --------------------

/**
 * One commit in a declared git history: stage `files` and commit them. Every
 * path must already exist in the sandbox — seeded by `setup.files` or created by
 * an earlier commit. The engine materializes the commit with pinned
 * author/committer/date, so declaring the same history twice yields the same
 * commit hash.
 */
export const GuardGitCommitSchema = z
  .object({
    /** Sandbox-relative paths to stage for this commit; each must already exist. */
    files: z.array(z.string()).min(1),
    /** Commit message; a fixed constant is used when omitted. */
    message: z.string().optional(),
  })
  .strict()

/**
 * Declarative git world-state a scenario needs. Presence of the block — even an
 * empty `git: {}` — means "initialize a repo in the sandbox cwd". The scenario
 * declares WHAT the repo looks like (its commits, its staged working-index, its
 * branch); the engine's git provider materializes it deterministically after
 * `setup.files` seeding. There is no HOW here — no commands, no shell.
 */
export const GuardGitSchema = z
  .object({
    /** Ordered commit history, built after `setup.files` are seeded. */
    commits: z.array(GuardGitCommitSchema).optional(),
    /** Paths staged but left uncommitted (the working index), applied after all commits. */
    staged: z.array(z.string()).optional(),
    /** Initial branch name; defaults to `main`. */
    branch: z.string().optional(),
  })
  .strict()

/**
 * Assertions on the REQUEST the app under test sends to a stub route, evaluated
 * every time the route is hit. A violated assertion fails the SCENARIO (the app
 * called the third party wrongly is a red test, not an invisible pass), reported
 * with the received value excerpted. All declared assertions must hold.
 */
export const GuardHttpStubExpectSchema = z
  .object({
    /** Substrings that must all appear in the RAW request body. */
    bodyContains: z.array(z.string().min(1)).min(1).optional(),
    /** Query parameter name → its exact expected value. */
    query: z.record(z.string(), z.string()).optional(),
    /** Dotted path into the JSON request body (`a.b[0].c`, `""` = the root) → the expected value. */
    jsonPath: z.record(z.string(), z.unknown()).optional(),
    /** Request header name (case-insensitive) → its exact expected value. */
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine(
    (e) =>
      e.bodyContains !== undefined ||
      e.query !== undefined ||
      e.jsonPath !== undefined ||
      e.headers !== undefined,
    { message: 'stub request assertion needs one of bodyContains | query | jsonPath | headers' },
  )

/**
 * One scripted route of a stub server: what it answers, and what the app must
 * have sent to reach it. Routes are matched in declaration order; the first whose
 * method and path match wins. Exactly one body form: `body` (raw text, sent
 * as-is) or `json` (a JSON value, sent with `content-type: application/json`).
 */
export const GuardHttpStubRouteSchema = z
  .object({
    method: z.enum(GUARD_HTTP_METHODS),
    /**
     * Request PATH to match — the pathname only (a query string is never part of
     * the match; assert on it with `expect.query`). Must start with `/`. Matching
     * is exact, except for a single trailing `*` segment (`/v1/orders/*`) which
     * matches any one-or-more-segment remainder.
     */
    path: z.string().regex(/^\//, 'path must start with /'),
    /** Response status code; 200 when omitted. */
    status: z.number().int().min(100).max(599).optional(),
    /** Response headers. */
    headers: z.record(z.string(), z.string()).optional(),
    /** Raw response body, sent byte-for-byte. */
    body: z.string().optional(),
    /** JSON response body; serialized and sent with `content-type: application/json`. */
    json: z.unknown().optional(),
    /** Assertions on the request that hit this route. See {@link GuardHttpStubExpectSchema}. */
    expect: GuardHttpStubExpectSchema.optional(),
    /**
     * Exact number of times this route must be hit over the scenario, checked at
     * scenario end. `0` asserts the app NEVER calls it. Omitted ⇒ any count.
     */
    calls: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((r) => r.body === undefined || r.json === undefined, {
    message: 'a stub route carries `body` or `json`, not both',
  })

/**
 * One scripted HTTP stub server — a fake third party the app under test talks to.
 * The engine boots it on loopback BEFORE the app starts and exposes its origin as
 * `${HTTP_STUB:<name>}`, which the scenario points the app's base-URL env var at
 * through `setup.env`. The scenario declares WHAT the third party answers and
 * what the app must send it; there is no HOW here — no code, no shell.
 */
export const GuardHttpStubSchema = z
  .object({
    /** Scripted routes, matched in declaration order. */
    routes: z.array(GuardHttpStubRouteSchema).min(1),
    /**
     * What a request matching NO route means. `error` (the default) fails the
     * scenario naming the method and path received — an unscripted call is a
     * contract mismatch, never a silent pass; `404` tolerates it (the stub still
     * answers 404). Either way the stub never proxies anywhere.
     */
    unmatched: z.enum(['error', '404']).optional(),
  })
  .strict()

/**
 * The `http` setup capability: stub name → its scripted server. The name is what
 * `${HTTP_STUB:<name>}` refers to, so it is restricted to `[A-Za-z0-9_-]`.
 */
export const GuardHttpStubsSchema = z.record(
  z.string().regex(/^[A-Za-z0-9_-]+$/, 'stub name must be [A-Za-z0-9_-]'),
  GuardHttpStubSchema,
)

// --- Setup & binding ------------------------------------------------

export const GuardSetupSchema = z
  .object({
    /** Declarative sandbox seeding: sandbox-relative path → file content. */
    files: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    /**
     * The `git` setup capability — declare a git repo (commits, staged files,
     * branch) the test needs. Optional and additive: scenarios without it are
     * unaffected. See {@link GuardGitSchema}.
     */
    git: GuardGitSchema.optional(),
    /**
     * The `http` setup capability — declare scripted third-party HTTP stubs the
     * test needs. Each stub's origin is exposed as `${HTTP_STUB:<name>}`, which
     * `setup.env` VALUES substitute, so the app under test reaches the stub
     * wherever it reads that dependency's base URL from the environment.
     * Optional and additive. See {@link GuardHttpStubSchema}.
     */
    http: GuardHttpStubsSchema.optional(),
  })
  .strict()

export const GuardBindsSchema = z
  .object({
    /** Repo-relative path of the spec document. */
    doc: z.string().min(1),
    /** Slugified heading path (the section anchor). */
    section: z.string().min(1),
    /** `sha256:…` over the normalized section text. */
    fingerprint: z.string().min(1),
  })
  .strict()

/**
 * The flow this scenario realizes. `fingerprint` is the flow's milestone
 * composition at authoring time — when it moves, synthesis reorganized what the
 * flow tests and the scenario re-authors at the next generate.
 */
export const GuardScenarioFlowRefSchema = z
  .object({
    id: z.string().min(1),
    fingerprint: z.string().min(1),
  })
  .strict()

/**
 * The journey path that grounds this scenario — the realization plan's journey
 * ids and their fingerprints at authoring time. A fingerprint mismatch against the
 * live catalog is a DRIFT ANNOTATION, never a run outcome: the steps are frozen
 * and remain a valid probe of the spec claims.
 */
export const GuardScenarioJourneyRefSchema = z
  .object({
    path: z.array(z.string().min(1)).min(1),
    fingerprints: z.array(z.string().min(1)).min(1),
  })
  .strict()

// --- The scenario ---------------------------------------------------

/** The driver-independent envelope fields (frozen across drivers). */
const envelope = {
  guard: z.literal(GUARD_FORMAT_VERSION),
  /** `<flow-id>.<surface>.<n>` for a generated scenario. */
  id: z.string().min(1),
  /** Restates in one line what the scenario verifies. */
  title: z.string().min(1),
  /** The flow realized here; absent on a hand-written scenario (Manual pseudo-flow). */
  flow: GuardScenarioFlowRefSchema.optional(),
  /** The grounding journey path; absent on a hand-written scenario. */
  journey: GuardScenarioJourneyRefSchema.optional(),
  /** Every section the flow's milestones come from — denormalized at write time. */
  binds: z.array(GuardBindsSchema).min(1),
  setup: GuardSetupSchema.optional(),
  normalize: z.array(GuardNormalizerSchema).default([]),
}

export const GuardCliScenarioSchema = z
  .object({
    ...envelope,
    driver: z.literal('cli'),
    steps: z.array(GuardStepSchema).min(1),
  })
  .strict()

export const GuardApiScenarioSchema = z
  .object({
    ...envelope,
    driver: z.literal('api'),
    steps: z.array(GuardApiStepSchema).min(1),
  })
  .strict()

/** A committed scenario — the per-driver variants, keyed by `driver`. */
export const GuardScenarioSchema = z.discriminatedUnion('driver', [
  GuardCliScenarioSchema,
  GuardApiScenarioSchema,
])

export type GuardStreamMatcher = z.infer<typeof GuardStreamMatcherSchema>
export type GuardFileMatcher = z.infer<typeof GuardFileMatcherSchema>
export type GuardExpect = z.infer<typeof GuardExpectSchema>
export type GuardStep = z.infer<typeof GuardStepSchema>
export type GuardHttpMethod = (typeof GUARD_HTTP_METHODS)[number]
export type GuardHttpRequest = z.infer<typeof GuardHttpRequestSchema>
export type GuardJsonMatcher = z.infer<typeof GuardJsonMatcherSchema>
export type GuardApiExpect = z.infer<typeof GuardApiExpectSchema>
export type GuardApiStep = z.infer<typeof GuardApiStepSchema>
export type GuardNormalizer = z.infer<typeof GuardNormalizerSchema>
export type GuardGitCommit = z.infer<typeof GuardGitCommitSchema>
export type GuardGit = z.infer<typeof GuardGitSchema>
export type GuardHttpStubExpect = z.infer<typeof GuardHttpStubExpectSchema>
export type GuardHttpStubRoute = z.infer<typeof GuardHttpStubRouteSchema>
export type GuardHttpStub = z.infer<typeof GuardHttpStubSchema>
export type GuardHttpStubs = z.infer<typeof GuardHttpStubsSchema>
export type GuardSetup = z.infer<typeof GuardSetupSchema>
export type GuardBinds = z.infer<typeof GuardBindsSchema>
export type GuardScenarioFlowRef = z.infer<typeof GuardScenarioFlowRefSchema>
export type GuardScenarioJourneyRef = z.infer<typeof GuardScenarioJourneyRefSchema>
export type GuardCliScenario = z.infer<typeof GuardCliScenarioSchema>
export type GuardApiScenario = z.infer<typeof GuardApiScenarioSchema>
export type GuardScenario = z.infer<typeof GuardScenarioSchema>

// --- Presentation: a committed scenario as a STEP LIST ----------------

/**
 * One step of a committed test, in the words a reader needs: what it does, the
 * world it does it in, and what it asserts. The dashboard renders this instead of
 * raw YAML (which stays available as the file's source).
 */
export interface GuardScenarioStepView {
  /** 1-based position — the number a failure's `step` names. */
  n: number
  /** What the step DOES: the argv line (cli) or `METHOD /path` (api). */
  command: string
  /** Env overlay for THIS step only, as `K=V` (cli); absent when none. */
  env?: string[]
  /** What it asserts, one line — "exit 0 · stdout contains “added”". */
  expectation: string
  /** The flow milestone this step realizes, when it names one. */
  milestone?: number
  /** Repeat count when the step runs more than once. */
  repeat?: number
}

/** `contains “x”` / `matches /x/` / `is “x”` — one stream/header/body matcher. */
function describeStreamMatcher(m: GuardStreamMatcher): string {
  if (m.equals !== undefined) return `is “${m.equals}”`
  if (m.contains !== undefined) return `contains “${m.contains}”`
  return `matches /${m.matches}/`
}

function describeFileMatcher(m: GuardFileMatcher): string {
  if (m.exists) return 'exists'
  if (m.absent) return 'is absent'
  if (m.equals !== undefined) return `is “${m.equals}”`
  return `contains “${m.contains}”`
}

function describeJsonMatcher(m: GuardJsonMatcher): string {
  if (m.exists) return 'exists'
  if (m.absent) return 'is absent'
  if (m.equals !== undefined) return `is ${JSON.stringify(m.equals)}`
  if (m.contains !== undefined) return `contains “${m.contains}”`
  return `matches /${m.matches}/`
}

function describeCliExpect(expect: GuardExpect): string {
  const parts: string[] = []
  if (expect.exit !== undefined) parts.push(`exit ${expect.exit}`)
  if (expect.stdout) parts.push(`stdout ${describeStreamMatcher(expect.stdout)}`)
  if (expect.stderr) parts.push(`stderr ${describeStreamMatcher(expect.stderr)}`)
  for (const [path, m] of Object.entries(expect.files ?? {})) {
    parts.push(`${path} ${describeFileMatcher(m)}`)
  }
  return parts.join(' · ')
}

function describeApiExpect(expect: GuardApiExpect): string {
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

/**
 * A parsed scenario as its step list. Anything that doesn't parse as a known
 * driver yields an empty list — the caller falls back to the raw source, never to
 * a half-rendered guess.
 */
export function describeGuardScenarioSteps(scenario: unknown): GuardScenarioStepView[] {
  const parsed = GuardScenarioSchema.safeParse(scenario)
  if (!parsed.success) return []
  const s = parsed.data
  if (s.driver === 'api') {
    return s.steps.map((step, i) => ({
      n: i + 1,
      command: `${step.request.method} ${step.request.path}`,
      expectation: describeApiExpect(step.expect),
      ...(step.milestone != null ? { milestone: step.milestone } : {}),
      ...(step.repeat != null ? { repeat: step.repeat } : {}),
    }))
  }
  return s.steps.map((step, i) => {
    const env = Object.entries(step.env ?? {}).map(([k, v]) => `${k}=${v}`)
    return {
      n: i + 1,
      command: step.run.join(' '),
      ...(env.length > 0 ? { env } : {}),
      expectation: describeCliExpect(step.expect),
      ...(step.milestone != null ? { milestone: step.milestone } : {}),
      ...(step.repeat != null ? { repeat: step.repeat } : {}),
    }
  })
}
