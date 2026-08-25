/**
 * The guard scenario — the committed, declarative test that realizes ONE
 * spec flow. One YAML file per scenario under `.truecourse/scenarios/<area>/`.
 *
 * A scenario is the executable product of a FLOW (spec-side: what to test) and a
 * INTERFACE path (code-side: how to test it): assertions come from the flow's spec
 * claims, steps from the interface. It carries `flow` (id + fingerprint),
 * `interface` (the realization path + its fingerprints), and the flow's section
 * bindings DENORMALIZED into `binds`, so the runner resolves staleness with no flow
 * lookup. Hand-written scenarios omit `flow`/`interface` and group under the Manual
 * pseudo-flow.
 *
 * The id IS the flow id — one scenario per flow.
 *
 * ONE SCHEMA, DRIVERS ON THE STEPS (2026-08-12). There is no scenario-level
 * `driver` field: the driver belongs to the STEP, and everything a surface used to
 * read off the envelope is derived from the steps instead —
 * {@link guardScenarioDrivers} for what a scenario exercises,
 * {@link isApiServerScenario} for which executor it takes. A legacy `driver:` key
 * is accepted and DROPPED at parse, so a corpus committed before the collapse
 * still loads; nothing writes it again.
 *
 * THIS MODULE IS THE COMPOSITION, not the vocabulary. The envelope (`id`,
 * `title`, `flow`, `interface`, `binds`, `server`, `setup`, `steps`, `teardown`,
 * `normalize`) is frozen across drivers and lives here, together with the setup
 * capabilities every driver shares, and the cross-step passes and presentation that
 * need to see a WHOLE scenario. Each driver's closed verb sub-schema lives in its own
 * module, and a new driver adds one file rather than a section here:
 *
 *   - `step-parts.ts` — the primitives every driver's verbs are built from (the text
 *     matcher, milestone attribution, the `cwd`/`note`/`timeoutMs` fields, the step
 *     kinds);
 *   - `cli-steps.ts`  — `run` / `git` / `write` / `delete` / `patch`;
 *   - `api-steps.ts`  — `request` / `boot` / `signal` / `logs`;
 *   - `web-steps.ts`  — `navigate` / `click` / `fill` / `upload` / `history` / `expect`.
 *
 * The dependency runs ONE WAY (primitives → driver verbs → this module), so a
 * driver's vocabulary can grow without this file growing with it. Every step MAY
 * carry the `milestone`s it realizes.
 */

import { z } from 'zod'
import { capturedNamesIn } from './capture.js'
import type { GuardStepActual } from './step-actuals.js'
import {
  milestoneClaims,
  milestoneOrder,
  type GuardStepKind,
  type GuardStepMilestone,
} from './step-parts.js'
import {
  GuardCliStepSchema,
  cliStepCaptureNames,
  cliStepKind,
  cliStepPatterns,
  describeCliCommand,
  describeCliExpect,
  isProcessStep,
  isRunStep,
  type GuardCliStep,
} from './cli-steps.js'
import {
  GUARD_HTTP_METHODS,
  GuardApiRequestStepSchema,
  GuardApiStepSchema,
  apiStepCaptureNames,
  apiStepPatterns,
  describeApiCommand,
  describeApiExpect,
  describeApiLifecycleStep,
  isApiRequestStep,
  isApiStep,
  type GuardApiStep,
} from './api-steps.js'
import { guardDriverIds, type GuardDriverId } from './drivers.js'
import {
  GuardWebStepSchema,
  describeWebCommand,
  describeWebExpect,
  isWebStep,
  webStepCaptureNames,
  webStepPatterns,
  type GuardWebStep,
} from './web-steps.js'

// --- Steps (the sandbox's drivers) -----------------------------------
//
// Each driver's verbs live in its own module (`cli-steps.ts`, `web-steps.ts`,
// `api-steps.ts`) — a driver's vocabulary is its own business, and this one only
// COMPOSES the drivers into a scenario.

/**
 * ONE step of a sandbox scenario: a cli action, a WEB action, or an HTTP REQUEST —
 * all taken in the SAME sandbox. They are one list because the sandbox is ONE WORLD
 * (§2, 2026-08-09) — a real promise spans surfaces ("run the analysis, the dashboard
 * shows it, the API answers it"), and a step list locked to one driver cannot state
 * it. Which executor runs a step is the STEP's business.
 *
 * A `request` step here is the api driver's own verb ({@link
 * GuardApiRequestStepSchema}), not a copy of it: the same schema, the same matchers,
 * the same capture channels. What differs is only WHERE it is sent — the sandbox's
 * served surface (the recipe's `web` block), the same origin the browser drives — so
 * a scenario can act through the UI and then read the RESULT as structured data
 * instead of regexing the page for it.
 *
 * DRIVER DISAMBIGUATION. A web verb declares `driver: web`, because a step whose only
 * verb is `expect` would otherwise be ambiguous against every other step's `expect`
 * BLOCK. Every other verb here is SELF-NAMING — `run`, `git`, `write`, `delete`,
 * `patch`, `request` — so it declares nothing, and each member of this union is a
 * `.strict()` object keyed by its own verb. There is no step this union accepts two
 * readings of.
 *
 * The api LIFECYCLE verbs (`boot`, `signal`, `logs`) deliberately stay out: they
 * drive a server PROCESS the api driver owns, and in a sandbox the served surface's
 * lifecycle belongs to the sandbox (started at the first step that needs it, torn
 * down with the scenario), not to a step.
 */
export const GuardSandboxStepSchema = z.union([
  GuardCliStepSchema,
  GuardWebStepSchema,
  GuardApiRequestStepSchema,
])

/**
 * A LIST of sandbox steps — named so every field that carries one shares ONE
 * declaration-emit-sized type reference: inlining the full step union twice into
 * the scenario schema's declaration exceeds the compiler's serialization cap
 * (TS7056).
 */
export type GuardSandboxStepListSchema = z.ZodArray<typeof GuardSandboxStepSchema>
const sandboxStepList: GuardSandboxStepListSchema = z.array(GuardSandboxStepSchema)

/**
 * ONE step of ANY scenario — the whole verb vocabulary: the sandbox's three
 * (cli, web, request) plus the api driver's process-LIFECYCLE verbs (`boot`,
 * `signal`, `logs`). One list, because there is one scenario schema; which
 * executor a scenario takes is derived from the steps themselves
 * ({@link isApiServerScenario}), never declared.
 *
 * The lifecycle verbs drive a server PROCESS the api driver owns, so they are only
 * well-formed in a scenario that runs on that server — the schema's own refinement
 * below states exactly that, which is the invariant the discriminated union used
 * to buy with a `driver` field.
 */
export const GuardScenarioStepSchema = z.union([
  GuardCliStepSchema,
  GuardWebStepSchema,
  GuardApiStepSchema,
])

/** {@link GuardSandboxStepListSchema}'s reason, for the whole-vocabulary list. */
export type GuardScenarioStepListSchema = z.ZodArray<typeof GuardScenarioStepSchema>
const scenarioStepList: GuardScenarioStepListSchema = z.array(GuardScenarioStepSchema)

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
    /**
     * The `user.name` / `user.email` every commit in this scenario is made under —
     * and the identity its `git` STEPS commit with. The runner pins one either way;
     * declaring it makes visible what a reader would otherwise have to trust: the
     * developer's own identity is never used inside a sandbox.
     */
    identity: z.object({ name: z.string().min(1), email: z.string().min(1) }).strict().optional(),
    /**
     * Sandbox-relative directory the repository is initialized in; the sandbox cwd
     * itself when omitted. A flow that needs SIBLINGS of the checkout (a linked
     * worktree, a fresh clone, a second repository) puts the repo in a subdirectory
     * so those siblings still live inside the sandbox. `commits[].files` and
     * `staged` are relative to this root, as they are to a real repository.
     */
    root: z.string().min(1).optional(),
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

// --- The externals fault script ----------------------------

/**
 * Which of a provided external service's calls a fault rule applies to. Both
 * fields are optional and AND together; a rule with no `match` applies to every
 * call. `path` uses the same language as a stub route — exact on the pathname,
 * except for a single trailing `*` segment; a query string is never matched.
 */
export const GuardExternalFaultMatchSchema = z
  .object({
    method: z.enum(GUARD_HTTP_METHODS).optional(),
    /** Request PATH to match (pathname only). Must start with `/`. */
    path: z.string().regex(/^\//, 'path must start with /').optional(),
  })
  .strict()
  .refine((m) => m.method !== undefined || m.path !== undefined, {
    message: 'a fault match needs `method` or `path` (omit `match` entirely to match every call)',
  })

/**
 * The response a fault rule serves INSTEAD of forwarding the call upstream.
 * Exactly one body form: `body` (raw text) or `json` (serialized, sent with
 * `content-type: application/json`).
 */
export const GuardExternalFaultResponseSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    json: z.unknown().optional(),
  })
  .strict()
  .refine((r) => r.body === undefined || r.json === undefined, {
    message: 'a fault response carries `body` or `json`, not both',
  })

/**
 * ONE fault rule for a provided external service. Rules are consulted in
 * declaration order on every call the app makes to that service; the FIRST
 * un-consumed rule whose `match` applies wins, and a call matching no rule is
 * forwarded upstream untouched. The vocabulary is deliberately small:
 *   - `respond` — answer the call from the scenario instead of the upstream;
 *   - `delayMs` — wait first, then do whatever else the rule says (respond, or
 *     forward): the way "slower than the app's timeout" is scripted;
 *   - `refuse` — destroy the connection unanswered (the app sees a network error,
 *     exactly as it would if the upstream were down);
 *   - `once` — consume the rule after it fires, so `[{refuse, once}, {}]` scripts
 *     "the first call fails, the retry succeeds".
 * A rule carrying only `match` is an explicit passthrough — useful as the tail of
 * a sequence, and identical to the default for unmatched calls.
 */
export const GuardExternalFaultSchema = z
  .object({
    /** Which calls this rule applies to; omitted ⇒ every call. */
    match: GuardExternalFaultMatchSchema.optional(),
    /** Serve this response instead of forwarding upstream. */
    respond: GuardExternalFaultResponseSchema.optional(),
    /** Wait this long before responding/forwarding — the upstream-timeout script. */
    delayMs: z.number().int().positive().max(600_000).optional(),
    /** Destroy the connection without answering (a refused/reset upstream). */
    refuse: z.literal(true).optional(),
    /** Fire at most once, then advance to the next rule — per-call sequencing. */
    once: z.boolean().optional(),
  })
  .strict()
  .refine((f) => !(f.respond !== undefined && f.refuse !== undefined), {
    message: 'a fault rule carries `respond` or `refuse`, not both',
  })
  .refine(
    (f) =>
      f.respond !== undefined ||
      f.refuse !== undefined ||
      f.delayMs !== undefined ||
      f.match !== undefined,
    {
      message:
        'a fault rule needs one of respond | delayMs | refuse | match (`match` alone is an explicit passthrough)',
    },
  )

/**
 * One provided external service as a scenario scripts it. The runner ALWAYS
 * routes a provided service's traffic through its own loopback proxy, so a
 * scenario needs no wiring: it declares only the faults it wants and, optionally,
 * how many calls the service must receive.
 */
export const GuardExternalSchema = z
  .object({
    /** Fault rules, consulted in declaration order. See {@link GuardExternalFaultSchema}. */
    faults: z.array(GuardExternalFaultSchema).min(1).optional(),
    /**
     * Exact number of calls this service must receive over the scenario (across
     * ALL of its endpoints), checked at scenario end. `0` asserts the app never
     * calls it; `1` is how "it does not retry" is asserted. Omitted ⇒ any count.
     */
    calls: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((e) => e.faults !== undefined || e.calls !== undefined, {
    message: 'an externals entry needs `faults` or `calls`',
  })

/**
 * The `externals` setup block: service name → its fault script for THIS scenario.
 * The name must be a service the recipe declares under `api.externals` AND that is
 * actually provided on this machine; anything else is a scenario defect (an
 * `error`, never a silent pass).
 */
export const GuardExternalsSchema = z.record(z.string().min(1), GuardExternalSchema)

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
    /**
     * The `externals` setup capability — script FAULTS on a third party the user
     * PROVIDED an account for. Every provided external is already reached
     * through a runner-managed loopback proxy, so unscripted traffic passes through
     * to the real service untouched; this block only says which calls must fail,
     * stall, or be refused, and how many the service must receive. Optional and
     * additive. See {@link GuardExternalSchema}.
     */
    externals: GuardExternalsSchema.optional(),
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
 * The interface path that grounds this scenario — the realization plan's interface
 * ids and their fingerprints at authoring time. A fingerprint mismatch against the
 * live catalog is a DRIFT ANNOTATION, never a run outcome: the steps are frozen
 * and remain a valid probe of the spec claims.
 */
export const GuardScenarioInterfaceRefSchema = z
  .object({
    path: z.array(z.string().min(1)).min(1),
    fingerprints: z.array(z.string().min(1)).min(1),
  })
  .strict()

// --- The scenario ---------------------------------------------------

/** The driver-independent envelope fields (frozen across drivers). */
const envelope = {
  /** The flow's id for a generated scenario — one scenario per flow. */
  id: z.string().min(1),
  /** Restates in one line what the scenario verifies. */
  title: z.string().min(1),
  /**
   * The PROMISE this test defends, in the flow's own plain words — its `goal`,
   * denormalized at write time so the promise rides the artifact: a reader of the
   * file alone knows what it is FOR without resolving `flow.id`
   * against `flows.json`, which is regenerated and may no longer name it. Written
   * by the engine, never authored by the model. Additive and optional — absent on
   * a hand-written scenario and on any file written before the field (the
   * `interfaceDrifted`/`server` precedent).
   */
  promise: z.string().min(1).optional(),
  /** The flow realized here; absent on a hand-written scenario (Manual pseudo-flow). */
  flow: GuardScenarioFlowRefSchema.optional(),
  /** The grounding interface path; absent on a hand-written scenario. */
  interface: GuardScenarioInterfaceRefSchema.optional(),
  /** Every section the flow's milestones come from — denormalized at write time. */
  binds: z.array(GuardBindsSchema).min(1),
  /**
   * SUPPLIED dependencies this scenario binds, by catalog entry name
   * (`scenarios/dependencies.json`). State the engine must never fabricate — a
   * codebase to analyze, an authenticated config dir, provider credentials — is
   * BOUND here, never built: the runner resolves the user-registered instance and
   * copies it into the sandbox, and with no instance registered the scenario
   * settles `blocked` naming the dependency instead of running against a stand-in.
   *
   * Declared explicitly so a binding that carries no `${supplied:…}` token (an
   * authenticated HOME the program finds by itself) is still visible; a scenario
   * that DOES carry tokens binds those names too, whether or not they are listed.
   * Additive and optional.
   */
  needs: z.array(z.string().min(1)).optional(),
  /**
   * The recipe server this scenario runs against (an `api.servers` key) — an
   * api-server scenario's binding. ENGINE-ASSIGNED at authoring from the app that
   * serves the flow's operations; absent ⇒ the recipe's default server, which is
   * what every pre-multi-server scenario means.
   */
  server: z.string().min(1).optional(),
  setup: GuardSetupSchema.optional(),
  normalize: z.array(GuardNormalizerSchema).default([]),
}

const GuardScenarioBodySchema = z
  .object({
    ...envelope,
    steps: scenarioStepList.min(1),
    /**
     * TEARDOWN steps — the restoration channel for HOST state a scenario
     * legitimately mutates OUTSIDE its sandbox (a user-level service it installs,
     * a supervisor registration), which the sandbox's own cleanup can never undo.
     *
     * On a green run these are ordinary steps: they execute after `steps` in
     * order, their expectations are verdict-affecting, and they may carry
     * milestones (a `dashboard uninstall` teardown step IS the uninstall claim's
     * proving step). What the channel buys is the OTHER path: after a failure,
     * an infrastructure error, or a cancellation, the runner still executes every
     * not-yet-reached teardown step BEST-EFFORT — recorded in evidence, never
     * changing the settled verdict, continuing past its own misses — so the host
     * is restored on exactly the runs that used to leak it. A best-effort miss is
     * annotated on the result (`teardownIncomplete`), never silent.
     *
     * Step NUMBERING is continuous: the first teardown step is step
     * `steps.length + 1` everywhere an index appears (failures, evidence,
     * load errors). Sandbox-only scenarios don't need this — the sandbox is
     * deleted either way; a teardown list that only touches sandbox state is
     * authoring noise. Additive and optional.
     */
    teardown: sandboxStepList.min(1).optional(),
  })
  .strict()
  // The api driver's process-LIFECYCLE verbs drive a server this scenario must own
  // outright: they restart it, signal it, read its output. That is only meaningful
  // on the api-server path, and a sandbox has no such process — its served surface
  // is the sandbox's to start and stop. This is the invariant the per-driver
  // schemas used to buy with a `driver` discriminator, stated directly.
  .refine(
    (s) =>
      !s.steps.some((step) => isApiStep(step) && !isApiRequestStep(step)) ||
      s.steps.every((step) => isApiStep(step)),
    {
      path: ['steps'],
      message:
        'a `boot` / `signal` / `logs` step drives the api server process, so it may only appear in a scenario whose every step is an api verb — mix one into a sandbox scenario and there is no process to drive',
    },
  )
  // …and for the same reason the teardown channel is the SANDBOX's: it restores
  // host state the sandbox's own cleanup cannot undo, executed best-effort by the
  // sandbox runner. The api path's server lifecycle is runner-owned end to end.
  .refine((s) => s.teardown === undefined || !s.steps.every((step) => isApiStep(step)), {
    path: ['teardown'],
    message:
      "teardown is the sandbox path's restoration channel; a scenario whose every step is an api verb runs against the recipe server, whose lifecycle the runner owns",
  })

/**
 * Drop the LEGACY scenario-level keys retired by later format cuts — `driver`
 * (2026-08-12: the driver belongs to the STEP) and `guard` (the format-version
 * marker, retired 2026-08-13). Corpora written before a cut still carry them and
 * must keep loading, so they are accepted and thrown away here, before the
 * `.strict()` body ever sees them. Nothing writes them again.
 */
function dropLegacyDriverKey(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (!('driver' in value) && !('guard' in value)) return value
  const { driver: _legacyDriver, guard: _legacyFormat, ...rest } = value as Record<string, unknown>
  return rest
}

/**
 * A committed scenario. ONE schema — the driver is the STEP's, so there is no
 * per-driver variant and no discriminator; which executor a scenario takes is
 * derived ({@link isApiServerScenario}).
 *
 * The annotation is the ONE place the refinements above are handed to the type
 * system: zod infers `steps` as the un-refined whole vocabulary, while the parsed
 * value is always one of the two well-formed shapes ({@link GuardScenario}) —
 * a `refine` cannot narrow its own output, so the cast states what it proved.
 */
export const GuardScenarioSchema: z.ZodType<GuardScenario, z.ZodTypeDef, unknown> = z.preprocess(
  dropLegacyDriverKey,
  GuardScenarioBodySchema,
) as unknown as z.ZodType<GuardScenario, z.ZodTypeDef, unknown>

/**
 * A scenario's FULL execution sequence: `steps` followed by `teardown` (the sandbox
 * path only — the api driver's server lifecycle is runner-owned, so it has no
 * teardown channel). This is the list every whole-scenario pass walks — the
 * loader's pattern/capture/claim cross-checks, the runner's loop, the step-view —
 * so a teardown step is numbered, validated, and rendered exactly like the step it
 * is: index `steps.length + n` for the n-th teardown step.
 */
export function guardExecutionSteps(scenario: GuardSandboxScenario): GuardSandboxStep[]
export function guardExecutionSteps(scenario: GuardScenario): GuardScenarioStep[]
export function guardExecutionSteps(scenario: GuardScenario): GuardScenarioStep[] {
  return scenario.teardown ? [...scenario.steps, ...scenario.teardown] : [...scenario.steps]
}

/**
 * THE execution-path predicate — the one thing the retired `driver` field decided,
 * now read off the steps that actually run. A scenario whose every executed step is
 * an api verb runs against the recipe's booted SERVER (the api path); anything else
 * runs in a SANDBOX, whichever mix of cli, web and `request` steps it holds. The
 * predicates are the drivers' own, so this can never disagree with what executes.
 *
 * Its negation narrows too: the schema's refinements make "not all api verbs" and
 * "every step is a sandbox verb" the same statement.
 */
export function isApiServerScenario(scenario: GuardScenario): scenario is GuardApiScenario {
  return guardExecutionSteps(scenario).every((step) => isApiStep(step))
}

/**
 * The drivers ONE scenario exercises, in registry order — its STEPS' kinds. An
 * api-server scenario is `api` throughout; a sandbox scenario wears one entry per
 * driver its steps use, so a mixed one wears several. This is what the manifest
 * records and what every driver chip, filter and per-driver tally reads.
 */
export function guardScenarioDrivers(scenario: GuardScenario): GuardDriverId[] {
  const found = new Set<GuardDriverId>()
  for (const step of guardExecutionSteps(scenario)) {
    if (isWebStep(step)) found.add('web')
    else if (isApiStep(step)) found.add('api')
    else found.add('cli')
  }
  return guardDriverIds.filter((id) => found.has(id))
}


export type GuardSandboxStep = z.infer<typeof GuardSandboxStepSchema>
export type GuardScenarioStep = z.infer<typeof GuardScenarioStepSchema>
export type GuardNormalizer = z.infer<typeof GuardNormalizerSchema>
export type GuardGitCommit = z.infer<typeof GuardGitCommitSchema>
export type GuardGit = z.infer<typeof GuardGitSchema>
export type GuardHttpStubExpect = z.infer<typeof GuardHttpStubExpectSchema>
export type GuardHttpStubRoute = z.infer<typeof GuardHttpStubRouteSchema>
export type GuardHttpStub = z.infer<typeof GuardHttpStubSchema>
export type GuardHttpStubs = z.infer<typeof GuardHttpStubsSchema>
export type GuardExternalFaultMatch = z.infer<typeof GuardExternalFaultMatchSchema>
export type GuardExternalFaultResponse = z.infer<typeof GuardExternalFaultResponseSchema>
export type GuardExternalFault = z.infer<typeof GuardExternalFaultSchema>
export type GuardExternal = z.infer<typeof GuardExternalSchema>
export type GuardExternals = z.infer<typeof GuardExternalsSchema>
export type GuardSetup = z.infer<typeof GuardSetupSchema>
export type GuardBinds = z.infer<typeof GuardBindsSchema>
export type GuardScenarioFlowRef = z.infer<typeof GuardScenarioFlowRefSchema>
export type GuardScenarioInterfaceRef = z.infer<typeof GuardScenarioInterfaceRefSchema>

/** Everything a scenario carries except the steps — frozen across drivers. */
export type GuardScenarioEnvelope = Omit<
  z.infer<typeof GuardScenarioBodySchema>,
  'steps' | 'teardown'
>

/**
 * A scenario the SANDBOX executes: cli, web and `request` steps in one world, plus
 * the optional teardown channel. The mixed case is the normal one — a promise that
 * spans surfaces is still one test.
 */
export interface GuardSandboxScenario extends GuardScenarioEnvelope {
  steps: GuardSandboxStep[]
  teardown?: GuardSandboxStep[]
}

/**
 * A scenario the API-SERVER path executes: every step an api verb, against the
 * recipe server `server` names (its default when absent). No teardown channel —
 * that server's lifecycle is the runner's, start to finish.
 */
export interface GuardApiScenario extends GuardScenarioEnvelope {
  steps: GuardApiStep[]
  teardown?: undefined
}

/**
 * A well-formed scenario: the two shapes the schema's refinements allow. The union
 * is not a format distinction — one schema writes both — it is the type-level
 * spelling of {@link isApiServerScenario}, so an executor can only ever be handed
 * steps it knows how to run.
 */
export type GuardScenario = GuardSandboxScenario | GuardApiScenario

// --- Regex-matcher validation ---------------------------------------

/**
 * A regex source in a scenario that does not compile — the offending step
 * (1-based), where in the step it sits, the source, and the `new RegExp` error
 * text. Both the authoring validate path and the committed-scenario loader report
 * an uncompilable pattern from this same evidence.
 */
export interface InvalidMatchPattern {
  /** 1-based index of the offending step. */
  step: number
  /** Where in the step the pattern sits — `expect.stdout`, `expect.json.data.id`, `logs.match`. */
  where: string
  /** The regex source that failed to compile. */
  pattern: string
  /** The `new RegExp` compile-error message. */
  error: string
}

/** Every regex source one step carries — each driver names its own. */
function stepPatterns(step: GuardScenarioStep): Array<{ where: string; pattern: string }> {
  if (isWebStep(step)) return webStepPatterns(step)
  if (isApiStep(step)) return apiStepPatterns(step)
  return cliStepPatterns(step as GuardCliStep)
}

/**
 * The first step carrying a regex source that does not compile under `new RegExp`
 * — the exact call the runner makes when it evaluates the matcher (no flags).
 * Returns null when every pattern compiles (or none is present). A non-compiling
 * pattern is always a bug: the log matcher throws outright and the stream/body/json
 * matchers turn into an unconditional mismatch, so it is rejected before birth
 * (authoring) and at load (committed scenarios) rather than after a wasted run.
 */
export function firstInvalidMatchPattern(
  steps: readonly GuardScenarioStep[],
): InvalidMatchPattern | null {
  for (let i = 0; i < steps.length; i++) {
    for (const { where, pattern } of stepPatterns(steps[i])) {
      try {
        new RegExp(pattern)
      } catch (e) {
        return { step: i + 1, where, pattern, error: e instanceof Error ? e.message : String(e) }
      }
    }
  }
  return null
}

// --- Capture composition (cross-step) ---------------------------------

/**
 * The capture names ONE step assigns, in declaration order — whichever driver it
 * belongs to. The two api channels (`capture` from the body, `captureHeaders`
 * from a header) share one namespace, so one name has exactly one source.
 */
export function stepCaptureNames(step: GuardScenarioStep): string[] {
  if (isWebStep(step)) return webStepCaptureNames(step)
  if (isApiStep(step)) return apiStepCaptureNames(step)
  return cliStepCaptureNames(step as GuardCliStep)
}

/**
 * A capture rule a scenario breaks, in the words the reporting surface prints.
 * `step` is the 1-based offender, or `null` when the defect is in `setup`.
 */
export interface CaptureDefect {
  step: number | null
  message: string
}

/**
 * Every capture rule a scenario breaks — the checks that need the WHOLE step list,
 * so the schema cannot state them and the runner must never discover them mid-run:
 *
 *  - SINGLE ASSIGNMENT — a name is captured once. A second capture of it would
 *    silently change what every earlier reference meant, depending on where the
 *    scenario had got to.
 *  - NO FORWARD REFERENCE — `${captured:x}` reads a value that must already exist.
 *    A reference no step captures at all is the same defect with a worse ending.
 *  - NO SELF REFERENCE — a step's own capture is resolved AFTER its expectation
 *    holds, so a step cannot use what it captures. Order is the whole mechanism.
 *  - NOTHING IN SETUP — `setup` materializes before the first step runs, so a
 *    `${captured:…}` there can never resolve.
 *
 * Reported ALL at once (not first-only): they are independent authoring mistakes,
 * and a corpus owner fixing them wants the list. Pure — the caller decides whether
 * they are load errors (committed scenarios) or a corrective re-ask (authoring).
 */
export function captureDefects(
  steps: readonly GuardScenarioStep[],
  setup?: GuardSetup,
): CaptureDefect[] {
  const defects: CaptureDefect[] = []
  /** name → the 1-based step that captured it. */
  const captured = new Map<string, number>()

  for (const name of capturedNamesIn(setup ?? {})) {
    defects.push({
      step: null,
      message:
        `setup references \${captured:${name}}, but setup materializes BEFORE the first step — ` +
        'nothing is captured yet',
    })
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stepNumber = i + 1
    const declares = new Set(stepCaptureNames(step))

    for (const name of capturedNamesIn(step)) {
      if (captured.has(name)) continue
      if (declares.has(name)) {
        defects.push({
          step: stepNumber,
          message:
            `step ${stepNumber} references \${captured:${name}}, which it captures itself — a captured ` +
            'value is readable only by LATER steps (a capture resolves after the step it belongs to)',
        })
        continue
      }
      const available = [...captured.keys()]
      defects.push({
        step: stepNumber,
        message:
          `step ${stepNumber} references \${captured:${name}}, which no earlier step captures — ${
            available.length > 0
              ? `the values captured before it are ${available.map((n) => `\${captured:${n}}`).join(', ')}`
              : 'no step before it captures anything'
          }`,
      })
    }

    for (const name of stepCaptureNames(step)) {
      const prior = captured.get(name)
      if (prior !== undefined) {
        defects.push({
          step: stepNumber,
          message:
            prior === stepNumber
              ? `step ${stepNumber} captures "${name}" twice — a step's body and header captures share ` +
                'ONE namespace, so a name has exactly one source'
              : `step ${stepNumber} captures "${name}", which step ${prior} already captured — a capture ` +
                'name is assigned ONCE per scenario',
        })
        continue
      }
      captured.set(name, stepNumber)
    }
  }

  return defects
}

// --- Presentation: a committed scenario as a STEP LIST ----------------

// (the step-kind vocabulary itself lives in `step-parts.ts`)

/**
 * One step of a committed test, in the words a reader needs: what it does, the
 * world it does it in, and what it asserts. The dashboard renders this instead of
 * raw YAML (which stays available as the file's source).
 *
 * Everything here is AUTHORED — read out of the file, true of the test whether or
 * not it ever ran. The one recorded field is {@link GuardScenarioStepView.actual},
 * merged in when the read names a run.
 */
export interface GuardScenarioStepView {
  /** 1-based position — the number a failure's `step` names. */
  n: number
  /** What the step drives — every step is one of these, so every row can say so. */
  kind: GuardStepKind
  /**
   * What the step DOES: the argv line (cli), `METHOD /path` (an api request), or
   * the lifecycle action (`boot the server`, `signal SIGTERM`, `read server stdout`).
   */
  command: string
  /** Env overlay for THIS step only, as `K=V` (a cli step, or an api `boot`); absent when none. */
  env?: string[]
  /** What it asserts, one line — "exit 0 · stdout contains “added”". */
  expectation: string
  /** The flow milestone POSITION this step realizes, when it names one. */
  milestone?: number
  /** The claim identities this step is tagged with, when it names any. */
  claims?: string[]
  /** Repeat count when the step runs more than once. */
  repeat?: number
  /** Sandbox-relative working directory, when the step declares one. */
  cwd?: string
  /** True when the step runs on a pseudo-terminal. */
  tty?: true
  /** The authoring note — why this assertion is the falsifiable form of the claim. */
  note?: string
  /**
   * True for a TEARDOWN step — one that also runs best-effort after a failure to
   * restore host state (see the scenario schema's `teardown`). Rendered as part of
   * the one numbered list, wearing this flag.
   */
  teardown?: true
  /**
   * What this step ACTUALLY did in the run the read named — merged in from that run's
   * evidence bundle (see {@link GuardStepActual}). Absent when the read named no run,
   * and when the step never executed in it: the detail then shows the authored half
   * alone, which is all that is true about such a step.
   */
  actual?: GuardStepActual
}

export function describeGuardScenarioSteps(scenario: unknown): GuardScenarioStepView[] {
  const parsed = GuardScenarioSchema.safeParse(scenario)
  if (!parsed.success) return []
  const s = parsed.data
  /** The milestone half of a step view — position and claim identities, when named. */
  const milestoneView = (value: GuardStepMilestone | undefined): Partial<GuardScenarioStepView> => {
    const order = milestoneOrder(value)
    const claims = milestoneClaims(value)
    return {
      ...(order != null ? { milestone: order } : {}),
      ...(claims.length > 0 ? { claims } : {}),
    }
  }

  // ONE numbered list across the boundary: teardown steps follow the main steps
  // with continuous numbering, wearing the `teardown` flag — the same indices the
  // runner's failures and evidence records use.
  return guardExecutionSteps(s).map((step, i) => {
    const teardown = i >= s.steps.length ? { teardown: true as const } : {}
    // A request step reads the same wherever it is taken — `METHOD /path` and its
    // matchers — and wears the `api` kind, because the surface it acts on is a
    // served one, not the shell.
    if (isApiRequestStep(step)) {
      return {
        n: i + 1,
        kind: 'api' as const,
        command: describeApiCommand(step),
        expectation: describeApiExpect(step.expect),
        ...milestoneView(step.milestone),
        ...(step.repeat != null ? { repeat: step.repeat } : {}),
        ...(step.note != null ? { note: step.note } : {}),
        ...teardown,
      }
    }
    // A web step's row reads like every other row — what it does, what it asserts —
    // and wears the `web` kind the step-kind vocabulary already reserved for it.
    if (isWebStep(step)) {
      return {
        n: i + 1,
        kind: 'web' as const,
        command: describeWebCommand(step),
        expectation: describeWebExpect(step.expect),
        ...milestoneView(step.milestone),
        ...(step.note != null ? { note: step.note } : {}),
        ...teardown,
      }
    }
    // The api LIFECYCLE verbs — they act on the booted server process, so they wear
    // the `api` kind and say what they do to it (`boot the server`, `signal SIGTERM`).
    if (isApiStep(step)) {
      return {
        n: i + 1,
        kind: 'api' as const,
        ...milestoneView(step.milestone),
        ...describeApiLifecycleStep(step),
        ...teardown,
      }
    }
    const env = isProcessStep(step)
      ? Object.entries(step.env ?? {}).map(([k, v]) => `${k}=${v}`)
      : []
    return {
      n: i + 1,
      kind: cliStepKind(step),
      command: describeCliCommand(step),
      ...(env.length > 0 ? { env } : {}),
      expectation: describeCliExpect(step.expect),
      ...milestoneView(step.milestone),
      ...(isRunStep(step) && step.repeat != null ? { repeat: step.repeat } : {}),
      ...(step.cwd != null ? { cwd: step.cwd } : {}),
      ...(isRunStep(step) && step.tty ? { tty: true as const } : {}),
      ...(step.note != null ? { note: step.note } : {}),
      ...teardown,
    }
  })
}

// --- Presentation: a committed scenario's STARTING WORLD ---------------

/**
 * The world a test STARTS in — the `setup:` block the runner materializes before
 * the first step, in the words a reader needs. Read beside the step list, which
 * only ever shows what the test DOES from here.
 *
 * The scripted-third-party capabilities (`http`, `externals`) are not part of it:
 * those say what the test TALKS TO, not the state it begins from.
 */
export interface GuardScenarioSetupView {
  /** Seeded files in declaration order: sandbox-relative path → its content. */
  files?: { path: string; content: string }[]
  /** The declared git world state, one line each. */
  git?: string[]
  /** The scenario-global env overlay as `K=V` — the shape a step's own overlay uses. */
  env?: string[]
}

/**
 * The declared git world as one line per fact. The block's PRESENCE means "there
 * is a repository here", so it always leads with that; everything after it is a
 * line only when the scenario declares it.
 */
function describeGuardGitSetup(git: GuardGit): string[] {
  const lines = [
    git.root ? `initializes a git repository in ${git.root}` : 'initializes a git repository',
  ]
  if (git.branch) lines.push(`on branch ${git.branch}`)
  if (git.identity) lines.push(`commits as ${git.identity.name} <${git.identity.email}>`)
  git.commits?.forEach((commit, i) => {
    const message = commit.message ? ` “${commit.message}”` : ''
    lines.push(`commit ${i + 1}${message} — ${commit.files.join(', ')}`)
  })
  if (git.staged && git.staged.length > 0) lines.push(`staged, uncommitted — ${git.staged.join(', ')}`)
  return lines
}

/**
 * A parsed scenario's setup as the detail reads it. `undefined` when the file
 * doesn't parse as a known driver, when it declares no setup at all, and when
 * everything it declares is outside this view — the surface then renders nothing
 * rather than an empty heading.
 */
export function describeGuardScenarioSetup(scenario: unknown): GuardScenarioSetupView | undefined {
  const parsed = GuardScenarioSchema.safeParse(scenario)
  if (!parsed.success || !parsed.data.setup) return undefined
  const setup = parsed.data.setup
  const files = Object.entries(setup.files ?? {}).map(([path, content]) => ({ path, content }))
  const git = setup.git ? describeGuardGitSetup(setup.git) : []
  const env = Object.entries(setup.env ?? {}).map(([k, v]) => `${k}=${v}`)
  const view: GuardScenarioSetupView = {
    ...(files.length > 0 ? { files } : {}),
    ...(git.length > 0 ? { git } : {}),
    ...(env.length > 0 ? { env } : {}),
  }
  return Object.keys(view).length > 0 ? view : undefined
}
