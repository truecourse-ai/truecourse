/**
 * Zod schemas for the guard-generator LLM outputs — the per-document claim
 * extraction, the recipe proposal, and the batched scenario authoring. The engine
 * parses raw model text against these before it trusts anything; nothing the model
 * returns reaches disk unvalidated.
 *
 * The scenario schema pieces (setup / step / normalizer) are imported from
 * `@truecourse/shared` — the SAME Zod definitions the runner validates committed
 * scenarios against — so a generated scenario's verb set can never drift from what
 * the engine executes. The model authors only the behavioral fields; the engine
 * assigns `id`, fills `binds`, and stamps `guard`, so those are relaxed here (the
 * model's values are overwritten regardless).
 *
 * The model-facing object schemas deliberately do NOT use `.strict()`: an extra
 * key from a smaller model is dropped, not a validation failure. Only the fields
 * the engine reads are constrained.
 */

import { z } from 'zod'
import {
  GuardSetupSchema,
  GuardStepObjectSchema,
  promptKeysNeedATerminal,
  GuardApiStepSchema,
  GuardApiRequestStepSchema,
  GuardNormalizerSchema,
  GuardTestabilityVerdictSchema,
  GuardWebStepSchema,
  guardDriverIds,
  isWebStep,
  type GuardApiRequestStep,
  type GuardDriverId,
  type GuardWebStep,
} from '@truecourse/shared'
import { isNoOpEntry, NO_OP_ENTRY_MESSAGE, RecipeWebSchema } from '@truecourse/guard-runner'

/** The per-section classification summary recorded in the manifest, derived from
 *  extraction (kept shape — the dashboard renders it as a coverage verdict). */
export const TestabilityVerdictSchema = GuardTestabilityVerdictSchema
export type TestabilityVerdict = z.infer<typeof TestabilityVerdictSchema>

/** The test drivers a claim can target — cli is authored today; the rest are
 *  recorded for coverage honesty until their drivers ship. Derived from the guard
 *  driver registry (its id order is the extraction schema's `driver` enum, which
 *  is fingerprinted — the registry keeps it stable). */
export const CLAIM_DRIVERS = guardDriverIds

/**
 * The api half of a recipe proposal — how to START the HTTP server under test.
 * A deliberate SUBSET of the runner's `RecipeApiSchema`: the model proposes only
 * what it can read off the repo — the serve argv, a health path, and the
 * datastore bring-up the repo itself ships (`services`: the compose-in-build
 * refusal points here, so the field must be proposable — documenso 2026-08-20,
 * where the schema gap killed an obedient session as "malformed"). Credentials
 * and seed are never model-proposed — they carry secrets.
 */
export const RecipeApiServerProposalSchema = z
  .object({
    /** Argv that starts this service. `${PORT}` is substituted at boot. */
    serve: z.array(z.string()).min(1),
    /** Health endpoint polled until 2xx (defaults to `/` in the runner). */
    healthPath: z.string().regex(/^\//, 'healthPath must start with /').optional(),
    /** Extra env for this service's process; values may carry `${PORT}`. */
    env: z.record(z.string(), z.string()).optional(),
    /** Repo-relative dir of the workspace package this service serves (`apps/api/v2`). */
    app: z.string().min(1).optional(),
    /**
     * Boot in the repo root instead of the throwaway sandbox — REQUIRED for any
     * workspace-mediated serve (`yarn workspace …`, `npm run -w …`), which dies
     * outside the workspace root. Mirrors the runner's `cwd`; without it the
     * 2026-08-20 cal.diy session could not express a bootable serve at all and
     * burned its budget on `--cwd` argv hacks.
     */
    cwd: z.literal('repo').optional(),
  })
  .strict()
export type RecipeApiServerProposal = z.infer<typeof RecipeApiServerProposalSchema>

export const RecipeApiProposalSchema = z
  .object({
    /** Argv that starts the HTTP server. `${PORT}` is substituted at boot. */
    serve: z.array(z.string()).min(1).optional(),
    /** Health endpoint polled until 2xx (defaults to `/` in the runner). */
    healthPath: z.string().regex(/^\//, 'healthPath must start with /').optional(),
    /** Extra env for the server process; values may carry `${PORT}`. */
    env: z.record(z.string(), z.string()).optional(),
    /** Boot in the repo root — required for a workspace-mediated serve. */
    cwd: z.literal('repo').optional(),
    /** Repo-relative dir of the workspace package the single serve drives. */
    app: z.string().min(1).optional(),
    /**
     * The datastore bring-up the repo ships (`docker compose … up`) and its
     * teardown — world SETUP, owned by the runner's lifecycle, which is exactly
     * why it may not hide inside `build`. Shared across every declared server.
     */
    services: z
      .object({
        up: z.string().min(1),
        down: z.string().min(1).optional(),
        /** Full-wipe restore (volumes included) — see the runner schema's `reset`. */
        reset: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /**
     * The multi-service shape: one named entry per HTTP service the
     * workspace ships. A monorepo with a web app AND an api service must declare
     * BOTH — declaring only one leaves every documented endpoint of the other
     * untestable, which is exactly how a run ends up asking the wrong server.
     */
    servers: z.record(z.string().min(1), RecipeApiServerProposalSchema).optional(),
    /** The `servers` key a scenario runs against when it names none. */
    defaultServer: z.string().min(1).optional(),
  })
  .strict()
  // The runner's own one-of rule, mirrored so an invalid proposal never reaches disk.
  .superRefine((api, ctx) => {
    const named = Object.keys(api.servers ?? {})
    if ((api.serve !== undefined) === (named.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'the api block declares either one `serve` argv or a non-empty `servers` map, never both and never neither',
        path: ['serve'],
      })
      return
    }
    if (named.length > 1 && api.defaultServer === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`defaultServer\` must name one of the declared servers (${named.join(', ')})`,
        path: ['defaultServer'],
      })
    }
    if (api.defaultServer !== undefined && !named.includes(api.defaultServer)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`defaultServer\` "${api.defaultServer}" is not one of the declared servers (${named.join(', ') || 'none'})`,
        path: ['defaultServer'],
      })
    }
  })
export type RecipeApiProposal = z.infer<typeof RecipeApiProposalSchema>

/**
 * The recipe discovery proposal — optional install + build command + the
 * preparation for at least one driver: an `entry` argv (cli) and/or an `api` block
 * (http server). Mirrors the runner's `RecipeSchema` refines: a proposal that
 * prepares NEITHER driver runs nothing, and one whose `entry` is a shell no-op
 * (`true`, `:`) runs nothing under test — neither ever validates, so a no-op
 * entrypoint cannot reach disk from a fresh proposal or a cached one.
 */
export const RecipeProposalSchema = z
  .object({
    install: z.string().min(1).optional(),
    build: z.string().min(1),
    entry: z
      .array(z.string())
      .min(1)
      .refine((e) => !isNoOpEntry(e), { message: NO_OP_ENTRY_MESSAGE })
      .optional(),
    env: z.record(z.string(), z.string()).optional(),
    api: RecipeApiProposalSchema.optional(),
    /**
     * The BROWSER surface — the runner's own `web` block, verbatim (serve argv,
     * healthPath, env, `app` naming the served workspace app in a monorepo).
     * Proposed, not hand-authored: a workspace that ships a browser app without
     * a `web` block leaves every screen-driven claim untestable, and the static
     * rules refuse exactly that.
     */
    web: RecipeWebSchema.optional(),
    /**
     * The product's OWN hostnames (`cal.com`, `api.cal.com`) — what keeps
     * detection from minting the app itself as a third-party external service.
     * Never a proposal-schema afterthought: without it every recipe the
     * fallback lands leaves detection reporting the app's own domains as
     * externals (cal.diy 2026-08-21: 81 detected services under a recipe with
     * no ownHosts). Hostnames only, no scheme, no path.
     */
    ownHosts: z
      .array(z.string().min(1).regex(/^[\w.-]+$/, 'a bare hostname — no scheme, no path'))
      .optional(),
  })
  .strict()
  .refine((r) => r.entry !== undefined || r.api !== undefined, {
    message: 'recipe needs an `entry` (cli driver) and/or an `api` block (api driver)',
  })
export type RecipeProposal = z.infer<typeof RecipeProposalSchema>

// ---------------------------------------------------------------------------
// Seed drafting (one call per repo)
// ---------------------------------------------------------------------------

/**
 * What a drafted seed PROMISES to emit — a strict subset of the runner's
 * `api.seed.provides`.
 *
 * `satisfies` (the OpenAPI security-scheme link) IS accepted because `guard setup`
 * shows the model the scheme names the corpus actually declares, so the mapping is a
 * selection from a closed set rather than a guess. The engine still filters it
 * (`toRecipeSeed`) against those same names — an invented one is dropped, never
 * written, because an unresolvable `satisfies` is a hard stop at the next generate.
 */
export const SeedProvidesProposalSchema = z
  .object({
    /** Credentials the script mints: name → the request header it is injected as. */
    credentials: z
      .record(
        z.string().min(1),
        z
          .object({
            header: z.string().min(1),
            /** The role this principal authenticates as, in the app's own words. */
            description: z.string().min(1).optional(),
            /** The OpenAPI security scheme it fulfills — must name a declared one. */
            satisfies: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
    /** Fixtures the script emits: name → the field names scenarios may reference. */
    fixtures: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)).optional(),
  })
  .strict()
  .refine(
    (p) => Object.keys(p.fixtures ?? {}).length > 0 || Object.keys(p.credentials ?? {}).length > 0,
    { message: 'a seed must provide at least one fixture or credential — an empty seed unblocks nothing' },
  )
export type SeedProvidesProposal = z.infer<typeof SeedProvidesProposalSchema>

/**
 * ONE drafted seed: the script FILE (path + full content) and the `api.seed` block
 * that runs it. Both are reviewable artifacts — the engine writes neither until it
 * has actually run the script and validated its manifest against `provides` with
 * the runner's own resolver.
 */
export const SeedProposalSchema = z
  .object({
    /** Repo-relative path the script is written to (e.g. `scripts/guard-seed.mjs`). */
    scriptPath: z.string().min(1),
    /** The script's full source text. */
    scriptContent: z.string().min(1),
    seed: z
      .object({
        /** The shell command that runs the script from the repo root. */
        command: z.string().min(1),
        provides: SeedProvidesProposalSchema,
      })
      .strict(),
  })
  .strict()
export type SeedProposal = z.infer<typeof SeedProposalSchema>

// ---------------------------------------------------------------------------
// Claim extraction (one call per document / view)
// ---------------------------------------------------------------------------

/**
 * One testable claim the model read out of a document: a single externally-
 * observable behavior, the driver that could assert it, the section it belongs to
 * (an anchor the engine snaps against the live index), and the observable a test
 * would check.
 */
export const ExtractedClaimSchema = z.object({
  claim: z.string().min(1),
  driver: z.enum(CLAIM_DRIVERS),
  sectionAnchor: z.string().min(1),
  reason: z.string().min(1),
})
export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>

/** A section the model judged to state no testable behavior — a visible coverage
 *  gap with an honest reason. */
export const UntestableNoteSchema = z.object({
  sectionAnchor: z.string().min(1),
  reason: z.string().min(1),
})
export type UntestableNote = z.infer<typeof UntestableNoteSchema>

/**
 * One document's (or view's) extraction: its claims plus per-section untestable
 * notes. Either array may be omitted (a doc with only claims, or only notes), but
 * at least one MUST be a real array — a wrong-shaped object with neither is a
 * malformed reply that triggers the corrective re-ask, never a silent empty read.
 * The engine unions views and snaps anchors after parsing.
 */
export const DocExtractionSchema = z
  .object({
    claims: z.array(ExtractedClaimSchema).optional(),
    untestable: z.array(UntestableNoteSchema).optional(),
  })
  .refine((d) => d.claims !== undefined || d.untestable !== undefined, {
    message: 'expected a "claims" and/or "untestable" array',
  })
  .transform((d) => ({ claims: d.claims ?? [], untestable: d.untestable ?? [] }))
export type DocExtraction = z.infer<typeof DocExtractionSchema>

// ---------------------------------------------------------------------------
// Scenario authoring (batched per claim)
// ---------------------------------------------------------------------------

/**
 * One scenario as the model authors it: the behavioral fields only. `id`,
 * `binds`, and `guard` are engine-owned, so we tolerate (and ignore) whatever the
 * model wrote for them via `.passthrough()`. One schema per runnable driver —
 * each authoring prompt embeds ITS driver's schema, and the engine knows which
 * surface it asked for, so the reply never declares one.
 */
/**
 * The runner's `run` step, minus the one argv form a MODEL can never write: the
 * omittable pair, which exists to drop a flag whose value comes from a
 * declared-optional registration field. Authoring never sees the dependency
 * catalog and never emits a `${supplied:…}` token, so the pair could only ever be
 * wrong here — and offering a vocabulary that cannot be used correctly costs every
 * authoring call the prompt bytes and buys nothing. Everything else is the runner's
 * own schema, so an authored step still cannot drift from what executes it.
 *
 * THE `run` STEP AND NOTHING ELSE. The cli driver executes five step kinds; a model
 * authors one. `git`, `write`, `delete` and — since 2026-08-09 — `patch` are the
 * REFERENCE corpus's vocabulary, hand-authored by someone who knows the subject's
 * files; a generated scenario states the world it needs in `setup` and then only
 * runs the program. Widening this is the Generate workstream's call to make
 * deliberately, and it is never free: this schema IS the prompt's canonical scenario
 * schema, so anything added here rolls `GENERATE_PROMPT_FINGERPRINT` and re-authors
 * every cli flow in the corpus. A runner-side step kind must therefore be added to
 * the runner's union WITHOUT touching this one, which is what `patch` did.
 */
const AuthoredCliStepSchema = GuardStepObjectSchema.extend({ run: z.array(z.string()) }).superRefine(
  promptKeysNeedATerminal,
)

export const RawGeneratedCliScenarioSchema = z
  .object({
    title: z.string().min(1),
    /**
     * The scenario's BLAST RADIUS. Omit (= `shared`) when the scenario only
     * ADDS state it creates itself; declare `mutates` when it mutates or
     * destroys state it did not mint — the seeded principal's credentials or
     * sessions, account deletion, global configuration — so the runner
     * schedules it last against a world it restores afterwards.
     */
    world: z.enum(['shared', 'mutates']).optional(),
    setup: GuardSetupSchema.optional(),
    steps: z.array(AuthoredCliStepSchema).min(1),
    normalize: z.array(GuardNormalizerSchema).optional(),
  })
  .passthrough()
export type RawGeneratedCliScenario = z.infer<typeof RawGeneratedCliScenarioSchema>

export const RawGeneratedApiScenarioSchema = z
  .object({
    title: z.string().min(1),
    /**
     * The scenario's BLAST RADIUS. Omit (= `shared`) when the scenario only
     * ADDS state it creates itself; declare `mutates` when it mutates or
     * destroys state it did not mint — the seeded principal's credentials or
     * sessions, account deletion, global configuration — so the runner
     * schedules it last against a world it restores afterwards.
     */
    world: z.enum(['shared', 'mutates']).optional(),
    setup: GuardSetupSchema.optional(),
    steps: z.array(GuardApiStepSchema).min(1),
    normalize: z.array(GuardNormalizerSchema).optional(),
  })
  .passthrough()
export type RawGeneratedApiScenario = z.infer<typeof RawGeneratedApiScenarioSchema>

/**
 * One step of an authored WEB scenario. A web scenario runs in ONE sandbox world
 * shared by three vocabularies, so beside the six web verbs it admits:
 *  - the authored cli `run` step (the SAME arm the cli prompt uses — `git`/`write`/
 *    `delete`/`patch` stay reference-corpus vocabulary here too), because a browser
 *    flow routinely needs a cli step to seed the world it then looks at;
 *  - the api `request` step, because "verify through the server what the UI just
 *    wrote" is half of what makes a web assertion honest. The api LIFECYCLE verbs
 *    (`boot`/`signal`/`logs`) deliberately stay out — in a sandbox the served
 *    surface's lifecycle belongs to the sandbox.
 */
/** One authored web-scenario step. The explicit annotation is load-bearing: the
 *  web step union's inferred type exceeds what tsc will serialize into a
 *  declaration (TS7056), and the alias keeps every schema built on it emittable. */
export type AuthoredWebStep = GuardWebStep | z.infer<typeof AuthoredCliStepSchema> | GuardApiRequestStep
const AuthoredWebStepSchema: z.ZodType<AuthoredWebStep, z.ZodTypeDef, unknown> = z.union([
  GuardWebStepSchema,
  AuthoredCliStepSchema,
  GuardApiRequestStepSchema,
])

/** The web arm's object shape alone — exported because the prompt's canonical
 *  schema hint needs `.strip()`, which the refinement wrapper below cannot offer
 *  (a refinement renders nothing in JSON Schema anyway; it exists for the parse). */
export const RawGeneratedWebScenarioObjectSchema = z
  .object({
    title: z.string().min(1),
    /**
     * The scenario's BLAST RADIUS. Omit (= `shared`) when the scenario only
     * ADDS state it creates itself; declare `mutates` when it mutates or
     * destroys state it did not mint — the seeded principal's credentials or
     * sessions, account deletion, global configuration — so the runner
     * schedules it last against a world it restores afterwards.
     */
    world: z.enum(['shared', 'mutates']).optional(),
    setup: GuardSetupSchema.optional(),
    steps: z.array(AuthoredWebStepSchema).min(1),
    normalize: z.array(GuardNormalizerSchema).optional(),
  })
  .passthrough()

export const RawGeneratedWebScenarioSchema = RawGeneratedWebScenarioObjectSchema.refine(
  (s) => s.steps.some(isWebStep),
  {
    path: ['steps'],
    message:
      'a web scenario carries at least one `driver: web` step — a draft of only run/request steps belongs on the cli or api surface',
  },
)
export type RawGeneratedWebScenario = z.infer<typeof RawGeneratedWebScenarioSchema>

/**
 * A scenario as authored, whichever surface the call was for. The arms are keyed by
 * their STEP VOCABULARY, not by a declared driver: an authored cli step always
 * carries `run`, an api step never does, and a web step tags itself `driver: web`,
 * so the union resolves without a discriminator (and each authoring call parses
 * against its own arm anyway — the prompt and the schema follow the same
 * `ctx.driver`, so a batch cannot smuggle one driver's vocabulary into another's).
 * The web arm sits LAST so no pre-existing cli/api draft's resolution changes.
 */
export const RawGeneratedScenarioSchema = z.union([
  RawGeneratedCliScenarioSchema,
  RawGeneratedApiScenarioSchema,
  RawGeneratedWebScenarioSchema,
])
export type RawGeneratedScenario = z.infer<typeof RawGeneratedScenarioSchema>

/**
 * The raw scenario schema ONE surface's drafts parse against. Parsing by surface —
 * the engine always knows which surface it asked for — is what turns a union
 * failure's useless `(root): Invalid input` into a field-path error the worker can
 * act on. A surface with no arm of its own falls back to the whole union.
 */
const RAW_SCENARIO_SCHEMAS = {
  cli: RawGeneratedCliScenarioSchema,
  api: RawGeneratedApiScenarioSchema,
  web: RawGeneratedWebScenarioSchema,
} as const satisfies Partial<Record<GuardDriverId, z.ZodTypeAny>>

export function rawScenarioSchemaFor(
  surface: GuardDriverId,
): z.ZodType<RawGeneratedScenario, z.ZodTypeDef, unknown> {
  return RAW_SCENARIO_SCHEMAS[surface as keyof typeof RAW_SCENARIO_SCHEMAS] ?? RawGeneratedScenarioSchema
}

/**
 * One (flow, surface) authoring call's output: the scenario that realizes the
 * flow's whole path on that surface, or an honest refusal. `scenario` absent (or
 * `null`) with a `blockedOn` list means the flow needs world-state neither the
 * sandbox nor the recipe can provide (a running service, a database, network,
 * credentials); the engine records it as a `blocked-on` gap rather than authoring
 * a scenario that could only die at birth. At least one of the two must be
 * present — a reply with neither is malformed and earns the corrective re-ask,
 * never a silent empty settle.
 */
export interface AuthoredFlowScenario {
  scenario: RawGeneratedScenario | null
  blockedOn: string[]
}
// Annotated for the same TS7056 reason as `AuthoredWebStepSchema` above: with
// the web arm in the union, the transform's inferred type stops being emittable.
export const AuthoredFlowScenarioSchema: z.ZodType<AuthoredFlowScenario, z.ZodTypeDef, unknown> = z
  .object({
    scenario: RawGeneratedScenarioSchema.nullish(),
    blockedOn: z.array(z.string().min(1)).optional(),
  })
  .refine((a) => a.scenario != null || (a.blockedOn?.length ?? 0) > 0, {
    message: 'expected a "scenario" object or a non-empty "blockedOn" array',
  })
  .transform((a) => ({
    scenario: a.scenario ?? null,
    blockedOn: a.scenario == null ? (a.blockedOn ?? []) : [],
  }))

/** The reply's two fields, narrowed to one driver's scenario shape. */
function authoredResponse(scenario: z.ZodTypeAny) {
  return z.object({
    scenario: scenario.nullish(),
    blockedOn: z.array(z.string().min(1)).optional(),
  })
}

/**
 * The authored reply as ONE driver's system prompt asks for it — the same two
 * fields {@link AuthoredFlowScenarioSchema} parses, narrowed to the driver whose
 * prompt the call carries (`.strip()` renders the scenario closed, exactly as the
 * prompt's canonical scenario schema is). Sent as the request's response schema so
 * the wire contract and the prompt come from ONE Zod source; the engine still
 * parses every reply with the driver-union above.
 */
export const AuthoredCliResponseSchema = authoredResponse(RawGeneratedCliScenarioSchema.strip())
export const AuthoredApiResponseSchema = authoredResponse(RawGeneratedApiScenarioSchema.strip())

// ---------------------------------------------------------------------------
// Fidelity review (one call per green scenario, after birth passes)
// ---------------------------------------------------------------------------

/**
 * The fidelity reviewer's verdict on ONE green scenario read against its section
 * and claim: `faithful` (the scenario genuinely verifies what the section/claim
 * asserts) or `flagged` (it is weak, vacuous, or miscast). A flagged verdict MUST
 * carry a one-sentence `mismatch` — the stated reason recorded as the finding's
 * evidence. The object schema is NOT strict: an extra key from a smaller model is
 * dropped, not a validation failure.
 */
export const FidelityReviewSchema = z.object({
  verdict: z.enum(['faithful', 'flagged']),
  mismatch: z.string().optional(),
  /**
   * Stated on a flagged verdict; HIGH drives the self-heal (discard the candidate,
   * re-author the flow once). Optional so a reviewer that omits it — and every
   * review cached before this field existed — reads as not-high: a plain rejection,
   * never an unbudgeted auto behavior.
   */
  confidence: z.enum(['high', 'medium', 'low']).optional(),
})
export type FidelityReview = z.infer<typeof FidelityReviewSchema>

// ---------------------------------------------------------------------------
// Flow synthesis (one call per area, plus one cross-area epic pass)
// ---------------------------------------------------------------------------

/**
 * One milestone as synthesis returns it: an already-extracted claim, addressed by
 * the document + section anchor it was extracted under. The engine SNAPS this
 * triple against the area's claim inventory — synthesis orders and groups claims,
 * it never authors one — so `claimTitle` is a copy of a claim's text, not new prose.
 * `order` is advisory (the engine renumbers the path 1..n).
 */
export const SynthesizedMilestoneSchema = z.object({
  doc: z.string().min(1),
  anchor: z.string().min(1),
  claimTitle: z.string().min(1),
  order: z.number().int().positive().optional(),
  note: z.string().optional(),
})
export type SynthesizedMilestone = z.infer<typeof SynthesizedMilestoneSchema>

/** One synthesized flow: a user-goal path over the area's claims. */
export const SynthesizedFlowSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  milestones: z.array(SynthesizedMilestoneSchema).min(1),
})
export type SynthesizedFlow = z.infer<typeof SynthesizedFlowSchema>

/** A claim synthesis deliberately placed in no flow, with its reason — the
 *  coverage honesty rule's other half. */
export const SynthesizedNoFlowClaimSchema = z.object({
  doc: z.string().min(1),
  anchor: z.string().min(1),
  claimTitle: z.string().min(1),
  reason: z.string().min(1),
})
export type SynthesizedNoFlowClaim = z.infer<typeof SynthesizedNoFlowClaimSchema>

/**
 * One area's synthesis output. Either array may be omitted (an area that composes
 * everything, or one that flows nothing), but at least one MUST be a real array —
 * a wrong-shaped object with neither is a malformed reply that triggers the
 * corrective re-ask, never a silent empty read (mirrors {@link DocExtractionSchema}).
 */
export const FlowSynthesisSchema = z
  .object({
    flows: z.array(SynthesizedFlowSchema).optional(),
    noFlowClaims: z.array(SynthesizedNoFlowClaimSchema).optional(),
  })
  .refine((d) => d.flows !== undefined || d.noFlowClaims !== undefined, {
    message: 'expected a "flows" and/or "noFlowClaims" array',
  })
  .transform((d) => ({ flows: d.flows ?? [], noFlowClaims: d.noFlowClaims ?? [] }))
export type FlowSynthesis = z.infer<typeof FlowSynthesisSchema>

/**
 * The flow-synthesis SESSION outcome (`guard-generate.flows`, plan 04 step 16) —
 * the same {flows, noFlowClaims} pair as {@link FlowSynthesisSchema}, but
 * `.strict()` with BOTH arrays required: the agent loop's outcome gate re-asks
 * on a malformed reply, so the one-shot schema's omission tolerance would only
 * hide a drifting model. It doubles as the `check_flows` tool's input schema —
 * the validator-as-tool pattern, where the draft a session checks IS the
 * outcome it will produce.
 */
export const FlowSetSchema = z
  .object({
    flows: z.array(SynthesizedFlowSchema),
    noFlowClaims: z.array(SynthesizedNoFlowClaimSchema),
  })
  .strict()
export type FlowSet = z.infer<typeof FlowSetSchema>

/**
 * One epic flow: a cross-area path that CHAINS flows the per-area pass already
 * produced. `composedOf` carries the digest refs of the chained flows (the engine
 * rewrites them to flow ids); every milestone must be one of those flows'
 * milestones, so an epic can never smuggle in a claim no flow covers.
 */
export const SynthesizedEpicFlowSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  composedOf: z.array(z.string().min(1)).min(2),
  milestones: z.array(SynthesizedMilestoneSchema).min(2),
})
export type SynthesizedEpicFlow = z.infer<typeof SynthesizedEpicFlowSchema>

/** The epic pass's output — an explicit (possibly empty) `epics` array. A reply
 *  without the key is malformed and re-asked, so "no epics" is always a stated
 *  answer rather than an unparsed one. */
export const EpicSynthesisSchema = z.object({
  epics: z.array(SynthesizedEpicFlowSchema),
})
export type EpicSynthesis = z.infer<typeof EpicSynthesisSchema>

// ---------------------------------------------------------------------------
// Realization matching (one call per flow × surface)
// ---------------------------------------------------------------------------

/** One step of a realization plan: the interface that realizes a milestone. */
export const RealizationStepSchema = z.object({
  /** An interface id copied verbatim from the surface's catalog digest. */
  interfaceId: z.string().min(1),
  /** The flow milestone (`order`) this interface realizes. */
  milestone: z.number().int().positive(),
  /** Optional one-liner on how the interface serves the milestone. */
  note: z.string().optional(),
})
export type RealizationStep = z.infer<typeof RealizationStepSchema>

/**
 * One flow's realization verdict on ONE surface: an ordered `plan` walking its
 * milestones through the surface's interfaces, or an explicit `unrealizable` reason
 * (no interface path serves the flow). Exactly one of the two — a reply carrying
 * both, or neither, is malformed and earns the corrective re-ask, so "this surface
 * cannot do it" is always a STATED answer rather than an empty plan.
 */

/**
 * The world-classify reply: which of the listed flows MUTATE shared world state
 * (credential changes, account deletion, session revocation, global config) —
 * their workers are scheduled last so a destructive draft cannot poison the
 * shared generate world for every sibling still authoring. One batched call per
 * generate, cached on the flow set.
 */
export const WorldClassifySchema = z
  .object({
    /** Flow ids judged world-mutating; every other listed flow is additive. */
    mutators: z.array(z.string()),
  })
  .strict()
export type WorldClassify = z.infer<typeof WorldClassifySchema>

/**
 * The claim-diff gate's reply for ONE edited section: `cosmetic` when the
 * current text still guarantees every previously extracted claim and adds no
 * observable behavior, `changed` otherwise. Cached per (prompt, new section
 * fingerprint, prior claims), so the same edit is judged once per repo.
 */
export const ClaimDiffSchema = z
  .object({
    verdict: z.enum(['cosmetic', 'changed']),
    reason: z.string().min(1),
  })
  .strict()
export type ClaimDiff = z.infer<typeof ClaimDiffSchema>

export const RealizationMatchSchema = z
  .object({
    plan: z.array(RealizationStepSchema).optional(),
    unrealizable: z.string().min(1).optional(),
  })
  .refine((m) => ((m.plan?.length ?? 0) > 0) !== (m.unrealizable !== undefined), {
    message: 'expected a non-empty "plan" array OR an "unrealizable" reason, not both',
  })
  .transform((m) => ({ plan: m.plan ?? [], unrealizable: m.unrealizable }))
export type RealizationMatch = z.infer<typeof RealizationMatchSchema>
