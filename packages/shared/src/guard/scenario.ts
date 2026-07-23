/**
 * Guard scenario format v1 — the committed, declarative test that binds a spec
 * section to executable behavior. One YAML file per scenario under
 * `.truecourse/scenarios/<area>/`.
 *
 * The envelope (`guard`, `id`, `title`, `binds`, `driver`, `setup`, `steps`,
 * `normalize`) is frozen across drivers; only the per-driver verb sub-schema
 * (keyed by `driver`) grows. The `cli` driver runs a `run` argv appended to the
 * recipe entrypoint, with `expect` matchers on exit code, streams, and files.
 * The `api` driver boots the recipe's HTTP server and drives it with `request`
 * steps, with `expect` matchers on status, headers, body text, and JSON paths.
 */

import { z } from 'zod'

/** Scenario format version carried in every file and echoed into the run store. */
export const GUARD_FORMAT_VERSION = 1

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

// --- Steps (cli driver) ----------------------------------------------

export const GuardStepSchema = z
  .object({
    /** Argv appended to the recipe entrypoint. May be empty (run the bare entry). */
    run: z.array(z.string()),
    stdin: z.string().optional(),
    /** Run the step N times; every iteration must satisfy `expect`. Default 1. */
    repeat: z.number().int().positive().optional(),
    expect: GuardExpectSchema,
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
    /** Run the step N times; every iteration must satisfy `expect`. Default 1. */
    repeat: z.number().int().positive().optional(),
    expect: GuardApiExpectSchema,
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

// --- The scenario ---------------------------------------------------

/** The driver-independent envelope fields (frozen across drivers). */
const envelope = {
  guard: z.literal(GUARD_FORMAT_VERSION),
  id: z.string().min(1),
  /** Restates the section's claim in one line. */
  title: z.string().min(1),
  binds: GuardBindsSchema,
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
export type GuardSetup = z.infer<typeof GuardSetupSchema>
export type GuardBinds = z.infer<typeof GuardBindsSchema>
export type GuardCliScenario = z.infer<typeof GuardCliScenarioSchema>
export type GuardApiScenario = z.infer<typeof GuardApiScenarioSchema>
export type GuardScenario = z.infer<typeof GuardScenarioSchema>
