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
  buildAuthorUserPrompt,
  RECIPE_SYSTEM_PROMPT,
  buildRecipeUserPrompt,
  type ExtractUserContext,
  type AuthorUserContext,
  type RecipeDiscoveryInput,
} from './prompts.js'

export type ExtractRunner = (input: ExtractUserContext) => Promise<unknown>
export type GenerateRunner = (input: AuthorUserContext) => Promise<unknown>
export type RecipeRunner = (input: RecipeDiscoveryInput) => Promise<unknown>

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

export function spawnGenerateRunner(opts: SpawnOptions = {}): GenerateRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 600_000
  return async (ctx) => {
    const refs = ctx.claims.map((c) => c.ref).join(',')
    const isRetry = ctx.claims.some((c) => c.retry)
    const suffix = `${isRetry ? ':retry' : ''}${ctx.correction ? ':correction' : ''}`
    const raw = await transport({
      id: `guard.generate:${ctx.doc}:${refs}${suffix}`,
      stage: 'guard.generate',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: GENERATE_SYSTEM_PROMPT,
      user: buildAuthorUserPrompt(ctx),
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
      id: `guard.recipe${input.correction ? ':correction' : ''}`,
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
