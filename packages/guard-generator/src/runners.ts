/**
 * The injectable LLM runners for the guard-generator stages. Production spawns the
 * model through the shared `LlmTransport` seam (cli by default, agent mailbox in
 * EE, or the direct-API transport); tests inject stubs. Each runner is output-only:
 * it returns the model's raw parsed JSON (`unknown`) and never writes files or runs
 * commands.
 *
 * Every request carries its stage's response schema, rendered from the SAME Zod
 * definition the engine validates the reply with (and the same one the prompt
 * embeds as its canonical output contract — one source, never two wordings). The
 * API transport submits it as provider-side STRUCTURED OUTPUT; the cli and agent
 * backends treat it as informational. Three stages carry a schema strict output
 * cannot express (a typed record); each says so with `enforceSchema: false` and a
 * comment naming the construct, never a silent degrade — the gate in
 * `tests/llm-api/stage-schemas.test.ts` pins the list.
 *
 * Enforcement never replaces the engine's own validation: the cli transport
 * enforces nothing, so the engine Zod-validates every reply and re-asks ONCE with
 * the invalid output quoted back (via each stage's `correction` context) before it
 * records a fail-soft failure.
 */

import {
  cliTransport,
  extractJsonValue,
  jsonSchemaHint,
  type LlmTransport,
} from '@truecourse/shared/llm'
import { GuardTriageSchema } from '@truecourse/shared'
import {
  AuthoredApiResponseSchema,
  AuthoredCliResponseSchema,
  DocExtractionSchema,
  EpicSynthesisSchema,
  FidelityReviewSchema,
  FlowSynthesisSchema,
  PartitionedApiResponseSchema,
  PartitionedCliResponseSchema,
  RealizationMatchSchema,
  RecipeProposalSchema,
  SeedProposalSchema,
} from './schemas.js'
import {
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  buildAuthorUserPrompt,
  RECIPE_SYSTEM_PROMPT,
  buildRecipeUserPrompt,
  SEED_SYSTEM_PROMPT,
  buildSeedUserPrompt,
  FIDELITY_SYSTEM_PROMPT,
  buildFidelityUserPrompt,
  FLOWS_SYSTEM_PROMPT,
  buildFlowsUserPrompt,
  FLOWS_EPIC_SYSTEM_PROMPT,
  buildFlowsEpicUserPrompt,
  MATCH_SYSTEM_PROMPT,
  buildMatchUserPrompt,
  type ExtractUserContext,
  type AuthorUserContext,
  type RecipeDiscoveryInput,
  type SeedDraftInput,
  type FidelityUserContext,
  type FlowsUserContext,
  type FlowsEpicUserContext,
  type MatchUserContext,
} from './prompts.js'
import { TRIAGE_SYSTEM_PROMPT, buildTriageUserPrompt, type TriageRunner } from './triage.js'

/** The response schema each stage sends on its request — one per reply contract,
 *  rendered once at module load from the engine's own Zod source. */
const EXTRACT_RESPONSE_SCHEMA = jsonSchemaHint(DocExtractionSchema)
const AUTHOR_CLI_RESPONSE_SCHEMA = jsonSchemaHint(AuthoredCliResponseSchema)
const AUTHOR_API_RESPONSE_SCHEMA = jsonSchemaHint(AuthoredApiResponseSchema)
const PARTITION_CLI_RESPONSE_SCHEMA = jsonSchemaHint(PartitionedCliResponseSchema)
const PARTITION_API_RESPONSE_SCHEMA = jsonSchemaHint(PartitionedApiResponseSchema)
const TRIAGE_RESPONSE_SCHEMA = jsonSchemaHint(GuardTriageSchema)
const FIDELITY_RESPONSE_SCHEMA = jsonSchemaHint(FidelityReviewSchema)
const FLOWS_RESPONSE_SCHEMA = jsonSchemaHint(FlowSynthesisSchema)
const FLOWS_EPIC_RESPONSE_SCHEMA = jsonSchemaHint(EpicSynthesisSchema)
const MATCH_RESPONSE_SCHEMA = jsonSchemaHint(RealizationMatchSchema)
const SEED_RESPONSE_SCHEMA = jsonSchemaHint(SeedProposalSchema)
const RECIPE_RESPONSE_SCHEMA = jsonSchemaHint(RecipeProposalSchema)

export type ExtractRunner = (input: ExtractUserContext) => Promise<unknown>
export type GenerateRunner = (input: AuthorUserContext) => Promise<unknown>
export type RecipeRunner = (input: RecipeDiscoveryInput) => Promise<unknown>
export type SeedRunner = (input: SeedDraftInput) => Promise<unknown>
export type FidelityRunner = (input: FidelityUserContext) => Promise<unknown>
export type FlowsRunner = (input: FlowsUserContext) => Promise<unknown>
export type FlowsEpicRunner = (input: FlowsEpicUserContext) => Promise<unknown>
export type MatchRunner = (input: MatchUserContext) => Promise<unknown>

interface SpawnOptions {
  transport?: LlmTransport
  model?: string
  fallbackModel?: string
  timeoutMs?: number
}

/**
 * The wall-clock ceiling both ADJUDICATION stages run at — 10 min, the heavy-stage
 * tier (extraction, flow synthesis), not the two minutes they used to get. A
 * fidelity review carries a scenario, its flow's milestones and every bound section
 * verbatim; a triage call adds the failing run's whole evidence transcript. At 120s
 * that is a ceiling live calls hit: a field run lost 2 of 22 reviews to it and
 * shipped their greens unjudged. The ceiling is only the backstop for pre-first-token
 * SILENCE — the stall timer (5 min without a stream event) is the hang guard, so a
 * call still making progress is never killed for taking a while.
 */
export const ADJUDICATION_TIMEOUT_MS = 600_000

export function spawnExtractRunner(opts: SpawnOptions = {}): ExtractRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 600_000
  return async (ctx) => {
    const suffix = `${ctx.view ? `:v${ctx.view.index}` : ''}${ctx.correction ? ':correction' : ''}`
    const raw = await transport({
      id: `guard.extract:${ctx.doc}${suffix}`,
      stage: 'guard.extract',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: EXTRACT_SYSTEM_PROMPT,
      user: buildExtractUserPrompt(ctx),
      responseFormat: 'json',
      schema: EXTRACT_RESPONSE_SCHEMA,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

export function spawnGenerateRunner(opts: SpawnOptions & { retryModel?: string } = {}): GenerateRunner {
  const transport = opts.transport ?? cliTransport()
  // 15 min, the widest ceiling of any stage — authoring (and its retry, which
  // runs through this same runner) has a heavy reasoning tail on borderline
  // claims: a measured batch spent 407s in pre-first-token silence before
  // finishing at 435s, so a 10-min ceiling killed live work, not hangs. The
  // stall timer stays the hang guard; this is only the backstop for silence.
  const timeoutMs = opts.timeoutMs ?? 900_000
  return async (ctx) => {
    const isRetry = ctx.retry !== undefined
    // Retries log under their own stage so their spend is attributed to the birth
    // phase (which drives the retry), not the already-completed authoring line.
    const stage = isRetry ? 'guard.retry' : 'guard.generate'
    const suffix = `${ctx.partition ? ':partition' : ''}${ctx.issues ? ':issues' : ''}${ctx.correction ? ':correction' : ''}`
    // The partition follow-up answers with `blockedMilestones` instead of
    // `blockedOn`; its wire schema says so, per driver like the authored one.
    const schema = ctx.partition
      ? ctx.driver === 'api'
        ? PARTITION_API_RESPONSE_SCHEMA
        : PARTITION_CLI_RESPONSE_SCHEMA
      : ctx.driver === 'api'
        ? AUTHOR_API_RESPONSE_SCHEMA
        : AUTHOR_CLI_RESPONSE_SCHEMA
    const raw = await transport({
      id: `${stage}:${ctx.flow.id}:${ctx.driver}${suffix}`,
      stage,
      model: isRetry ? (opts.retryModel ?? opts.model) : opts.model,
      fallbackModel: opts.fallbackModel,
      // One authoring runner, one system prompt PER DRIVER — a batch never mixes.
      system: ctx.driver === 'api' ? GENERATE_API_SYSTEM_PROMPT : GENERATE_SYSTEM_PROMPT,
      user: buildAuthorUserPrompt(ctx),
      responseFormat: 'json',
      // The reply's schema follows the prompt's driver, so the two never disagree.
      schema,
      // A scenario's `setup.files` / `setup.env` are records (name → value) and its
      // http stubs another — strict structured output has no equivalent, so the
      // schema rides as a prompt hint and the engine's Zod validates the reply. The
      // root is an object, so the JSON mode this opt-out selects can still return it.
      enforceSchema: false,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

/** Failing-test triage — one top-tier judgment call per birth failure.
 *  The runner type lives in `triage.ts`; re-exported so callers import runners only. */
export type { TriageRunner } from './triage.js'

export function spawnTriageRunner(opts: SpawnOptions = {}): TriageRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? ADJUDICATION_TIMEOUT_MS
  return async (ctx) => {
    const raw = await transport({
      id: `guard.triage:${ctx.flow.id}:${ctx.surface}${ctx.correction ? ':correction' : ''}`,
      stage: 'guard.triage',
      // A lost verdict must name the TEST it was about, not just its stage.
      subject: ctx.scenarioId ?? `${ctx.flow.id} · ${ctx.surface}`,
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: TRIAGE_SYSTEM_PROMPT,
      user: buildTriageUserPrompt(ctx),
      responseFormat: 'json',
      schema: TRIAGE_RESPONSE_SCHEMA,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

export function spawnFidelityRunner(opts: SpawnOptions = {}): FidelityRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? ADJUDICATION_TIMEOUT_MS
  return async (ctx) => {
    const raw = await transport({
      // One review per (flow, surface): the surface belongs in the id, or a flow's
      // two reviews log as one call twice.
      id: `guard.fidelity:${ctx.flow.id}:${ctx.surface}${ctx.correction ? ':correction' : ''}`,
      stage: 'guard.fidelity',
      // A lost review must name the TEST it was judging, not just its stage.
      subject: ctx.scenarioId,
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: FIDELITY_SYSTEM_PROMPT,
      user: buildFidelityUserPrompt(ctx),
      responseFormat: 'json',
      schema: FIDELITY_RESPONSE_SCHEMA,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

/** Per-area flow synthesis — composition over one area's extracted claims. */
export function spawnFlowsRunner(opts: SpawnOptions = {}): FlowsRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 600_000
  return async (ctx) => {
    const suffix = `${ctx.issues ? ':issues' : ''}${ctx.correction ? ':correction' : ''}`
    const raw = await transport({
      id: `guard.flows:${ctx.areaId}${suffix}`,
      stage: 'guard.flows',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: FLOWS_SYSTEM_PROMPT,
      user: buildFlowsUserPrompt(ctx),
      responseFormat: 'json',
      schema: FLOWS_RESPONSE_SCHEMA,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

/** The cross-area epic pass — one call over the synthesized flows' digests. */
export function spawnFlowsEpicRunner(opts: SpawnOptions = {}): FlowsEpicRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 600_000
  return async (ctx) => {
    const suffix = `${ctx.issues ? ':issues' : ''}${ctx.correction ? ':correction' : ''}`
    const raw = await transport({
      id: `guard.flows:epic${suffix}`,
      stage: 'guard.flows',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: FLOWS_EPIC_SYSTEM_PROMPT,
      user: buildFlowsEpicUserPrompt(ctx),
      responseFormat: 'json',
      schema: FLOWS_EPIC_RESPONSE_SCHEMA,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

/** Realization matching — one call per (flow, surface with a non-empty catalog). */
export function spawnMatchRunner(opts: SpawnOptions = {}): MatchRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 300_000
  return async (ctx) => {
    const suffix = `${ctx.issues ? ':issues' : ''}${ctx.correction ? ':correction' : ''}`
    const raw = await transport({
      id: `guard.match:${ctx.flow.id}:${ctx.surface}${suffix}`,
      stage: 'guard.match',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: MATCH_SYSTEM_PROMPT,
      user: buildMatchUserPrompt(ctx),
      responseFormat: 'json',
      schema: MATCH_RESPONSE_SCHEMA,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

/**
 * Seed drafting — ONE call per repo, and an expensive one: it writes a
 * whole script file, so it gets the authoring-tier ceiling rather than the recipe
 * proposer's two minutes.
 */
export function spawnSeedRunner(opts: SpawnOptions = {}): SeedRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 900_000
  return async (input) => {
    const raw = await transport({
      id: `guard.seed${input.retry ? ':retry' : ''}${input.correction ? ':correction' : ''}`,
      stage: 'guard.seed',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: SEED_SYSTEM_PROMPT,
      user: buildSeedUserPrompt(input),
      responseFormat: 'json',
      schema: SEED_RESPONSE_SCHEMA,
      // A seed's `provides` names its credentials and fixtures as records (name →
      // shape), which strict structured output cannot express — the schema stays a
      // prompt hint and the engine's Zod validates the reply.
      enforceSchema: false,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

export function spawnRecipeRunner(opts: SpawnOptions = {}): RecipeRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 120_000
  return async (input) => {
    const raw = await transport({
      id: `guard.recipe${input.retry ? ':retry' : ''}${input.correction ? ':correction' : ''}`,
      stage: 'guard.recipe',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: RECIPE_SYSTEM_PROMPT,
      user: buildRecipeUserPrompt(input),
      responseFormat: 'json',
      schema: RECIPE_RESPONSE_SCHEMA,
      // `env` is a record (name → value), and so is the multi-service `servers` map —
      // strict structured output has no equivalent, so the schema stays a prompt hint
      // and the engine's Zod validates the reply.
      enforceSchema: false,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}
