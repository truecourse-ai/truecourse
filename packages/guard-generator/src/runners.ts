/**
 * The injectable LLM runners for the three guard-generator stages. Production
 * spawns the model through the shared `LlmTransport` seam (cli by default, agent
 * mailbox in EE); tests inject stubs. Each runner is output-only: it returns the
 * model's raw parsed JSON (`unknown`) and never writes files or runs commands. The
 * CLI transport enforces no response schema, so the engine — not the runner —
 * Zod-validates the output, re-asking ONCE with the invalid output quoted back
 * (via each stage's `correction` context) before it records a fail-soft failure.
 */

import {
  cliTransport,
  extractJsonValue,
  jsonSchemaHint,
  type LlmTransport,
} from '@truecourse/shared/llm'
import { GuardTriageSchema } from '@truecourse/shared'
import {
  DocExtractionSchema,
  AuthoredBatchSchema,
  FidelityReviewSchema,
  RecipeProposalSchema,
} from './schemas.js'
import {
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
  GENERATE_SYSTEM_PROMPT,
  buildAuthorUserPrompt,
  RECIPE_SYSTEM_PROMPT,
  buildRecipeUserPrompt,
  FIDELITY_SYSTEM_PROMPT,
  buildFidelityUserPrompt,
  type ExtractUserContext,
  type AuthorUserContext,
  type RecipeDiscoveryInput,
  type FidelityUserContext,
} from './prompts.js'
import {
  TRIAGE_SYSTEM_PROMPT,
  buildTriageUserPrompt,
  type TriageUserContext,
  type TriageRunner,
} from './triage.js'
import {
  EXEMPLAR_SYSTEM_PROMPT,
  buildExemplarUserPrompt,
  ExemplarPackSchema,
  type ExemplarUserContext,
  type ExemplarRunner,
} from './exemplars.js'
import {
  CLUSTER_SYSTEM_PROMPT,
  buildClusterUserPrompt,
  ClusterResponseSchema,
  type ClusterUserContext,
  type ClusterRunner,
} from './cluster.js'

/** The response schema each stage sends on its request, rendered from the SAME
 *  Zod definition the engine validates the reply with. The API transport enforces
 *  it via structured output; the cli transport ignores it. */
const EXTRACT_RESPONSE_SCHEMA = jsonSchemaHint(DocExtractionSchema)
const AUTHOR_RESPONSE_SCHEMA = jsonSchemaHint(AuthoredBatchSchema)
const FIDELITY_RESPONSE_SCHEMA = jsonSchemaHint(FidelityReviewSchema)
const TRIAGE_RESPONSE_SCHEMA = jsonSchemaHint(GuardTriageSchema)
const EXEMPLAR_RESPONSE_SCHEMA = jsonSchemaHint(ExemplarPackSchema)
const CLUSTER_RESPONSE_SCHEMA = jsonSchemaHint(ClusterResponseSchema)
const RECIPE_RESPONSE_SCHEMA = jsonSchemaHint(RecipeProposalSchema)

export type ExtractRunner = (input: ExtractUserContext) => Promise<unknown>
export type GenerateRunner = (input: AuthorUserContext) => Promise<unknown>
export type RecipeRunner = (input: RecipeDiscoveryInput) => Promise<unknown>
export type FidelityRunner = (input: FidelityUserContext) => Promise<unknown>
export type { TriageRunner } from './triage.js'
export type { ExemplarRunner } from './exemplars.js'
export type { ClusterRunner } from './cluster.js'

interface SpawnOptions {
  transport?: LlmTransport
  model?: string
  fallbackModel?: string
  timeoutMs?: number
}

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
  const timeoutMs = opts.timeoutMs ?? 600_000
  return async (ctx) => {
    const refs = ctx.claims.map((c) => c.ref).join(',')
    // A birth retry AND a family re-author (item 4) both log under the fix-phase stage
    // so their spend is attributed to the birth/repair phase that drives them, not the
    // already-completed authoring line.
    const isRetry = ctx.claims.some((c) => c.retry || c.familyCorrection)
    const stage = isRetry ? 'guard.retry' : 'guard.generate'
    const raw = await transport({
      id: `${stage}:${ctx.doc}:${refs}${ctx.correction ? ':correction' : ''}`,
      stage,
      model: isRetry ? (opts.retryModel ?? opts.model) : opts.model,
      fallbackModel: opts.fallbackModel,
      system: GENERATE_SYSTEM_PROMPT,
      user: buildAuthorUserPrompt(ctx),
      responseFormat: 'json',
      schema: AUTHOR_RESPONSE_SCHEMA,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

export function spawnFidelityRunner(opts: SpawnOptions = {}): FidelityRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 120_000
  return async (ctx) => {
    const raw = await transport({
      id: `guard.fidelity:${ctx.doc}:${ctx.sectionHeading}${ctx.correction ? ':correction' : ''}`,
      stage: 'guard.fidelity',
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

export function spawnTriageRunner(opts: SpawnOptions = {}): TriageRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 120_000
  return async (ctx: TriageUserContext) => {
    const raw = await transport({
      id: `guard.triage:${ctx.doc}:${ctx.sectionHeading}${ctx.correction ? ':correction' : ''}`,
      stage: 'guard.triage',
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

export function spawnExemplarRunner(opts: SpawnOptions = {}): ExemplarRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 300_000
  return async (ctx: ExemplarUserContext) => {
    const raw = await transport({
      id: `guard.exemplars:${ctx.subject}${ctx.correction ? ':correction' : ''}`,
      stage: 'guard.exemplars',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: EXEMPLAR_SYSTEM_PROMPT,
      user: buildExemplarUserPrompt(ctx),
      responseFormat: 'json',
      schema: EXEMPLAR_RESPONSE_SCHEMA,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

export function spawnClusterRunner(opts: SpawnOptions = {}): ClusterRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 120_000
  return async (ctx: ClusterUserContext) => {
    const raw = await transport({
      id: `guard.cluster:${ctx.briefs.length}${ctx.correction ? ':correction' : ''}`,
      stage: 'guard.cluster',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: CLUSTER_SYSTEM_PROMPT,
      user: buildClusterUserPrompt(ctx),
      responseFormat: 'json',
      schema: CLUSTER_RESPONSE_SCHEMA,
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
      id: `guard.recipe${input.correction ? ':correction' : ''}`,
      stage: 'guard.recipe',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: RECIPE_SYSTEM_PROMPT,
      user: buildRecipeUserPrompt(input),
      responseFormat: 'json',
      schema: RECIPE_RESPONSE_SCHEMA,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}
