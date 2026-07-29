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
  type LlmTransport,
} from '@truecourse/shared/llm'
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
    const suffix = `${ctx.issues ? ':issues' : ''}${ctx.correction ? ':correction' : ''}`
    const raw = await transport({
      id: `${stage}:${ctx.flow.id}:${ctx.driver}${suffix}`,
      stage,
      model: isRetry ? (opts.retryModel ?? opts.model) : opts.model,
      fallbackModel: opts.fallbackModel,
      // One authoring runner, one system prompt PER DRIVER — a batch never mixes.
      system: ctx.driver === 'api' ? GENERATE_API_SYSTEM_PROMPT : GENERATE_SYSTEM_PROMPT,
      user: buildAuthorUserPrompt(ctx),
      responseFormat: 'json',
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
      id: `guard.fidelity:${ctx.flow.id}${ctx.correction ? ':correction' : ''}`,
      stage: 'guard.fidelity',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: FIDELITY_SYSTEM_PROMPT,
      user: buildFidelityUserPrompt(ctx),
      responseFormat: 'json',
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
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

/**
 * Seed drafting (item 66) — ONE call per repo, and an expensive one: it writes a
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
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}
