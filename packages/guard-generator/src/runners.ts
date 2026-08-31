/**
 * The injectable LLM runners for the guard-generator stages that are still
 * ONE-SHOTS: recipe discovery (deliberately kept — see plan section 03) and
 * realization matching. Everything else (extraction, flow synthesis, the
 * flow-worker author/adjudicate loop and its fidelity child) runs as agent
 * sessions injected through the session seams (plan 04); their runners were
 * retired by step 20.
 *
 * Production spawns the model through the shared `LlmTransport` seam (cli by
 * default, agent mailbox in EE, or the direct-API transport); tests inject
 * stubs. Each runner is output-only: it returns the model's raw parsed JSON
 * (`unknown`) and never writes files or runs commands.
 *
 * Every request carries its stage's response schema, rendered from the SAME Zod
 * definition the engine validates the reply with (and the same one the prompt
 * embeds as its canonical output contract — one source, never two wordings). The
 * API transport submits it as provider-side STRUCTURED OUTPUT; the cli and agent
 * backends treat it as informational. The recipe stage carries a schema strict
 * output cannot express (a typed record); it says so with `enforceSchema: false`
 * and a comment naming the construct, never a silent degrade — the gate in
 * `tests/llm-api/stage-schemas.test.ts` pins the list.
 *
 * Enforcement never replaces the engine's own validation: the cli transport
 * enforces nothing, so the engine Zod-validates every reply and re-asks ONCE with
 * the invalid output quoted back (via each stage's `correction` context) before it
 * records a fail-soft failure.
 */

import { cliTransport, extractJsonValue, jsonSchemaHint, type LlmTransport } from '@truecourse/shared/llm'
import { RealizationMatchSchema, RecipeProposalSchema, WorldClassifySchema } from './schemas.js'
import {
  RECIPE_SYSTEM_PROMPT,
  buildRecipeUserPrompt,
  MATCH_SYSTEM_PROMPT,
  buildMatchUserPrompt,
  WORLD_CLASSIFY_SYSTEM_PROMPT,
  buildWorldClassifyUserPrompt,
  type RecipeDiscoveryInput,
  type MatchUserContext,
  type WorldClassifyFlowInput,
} from './prompts.js'

/** The response schema each stage sends on its request — one per reply contract,
 *  rendered once at module load from the engine's own Zod source. */
const MATCH_RESPONSE_SCHEMA = jsonSchemaHint(RealizationMatchSchema)
const RECIPE_RESPONSE_SCHEMA = jsonSchemaHint(RecipeProposalSchema)
const WORLD_CLASSIFY_RESPONSE_SCHEMA = jsonSchemaHint(WorldClassifySchema)

export type RecipeRunner = (input: RecipeDiscoveryInput) => Promise<unknown>
export type MatchRunner = (input: MatchUserContext) => Promise<unknown>
export type WorldClassifyRunner = (flows: readonly WorldClassifyFlowInput[]) => Promise<unknown>

interface SpawnOptions {
  transport?: LlmTransport
  model?: string
  fallbackModel?: string
  timeoutMs?: number
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

/** World classification — ONE batched call per generate over the changed flows,
 *  deciding which workers the pool schedules into the mutator tail. */
export function spawnWorldClassifyRunner(opts: SpawnOptions = {}): WorldClassifyRunner {
  const transport = opts.transport ?? cliTransport()
  const timeoutMs = opts.timeoutMs ?? 300_000
  return async (flows) => {
    const raw = await transport({
      id: 'guard.world-classify',
      stage: 'guard.world-classify',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: WORLD_CLASSIFY_SYSTEM_PROMPT,
      user: buildWorldClassifyUserPrompt(flows),
      responseFormat: 'json',
      schema: WORLD_CLASSIFY_RESPONSE_SCHEMA,
      timeoutMs,
    })
    return JSON.parse(extractJsonValue(raw))
  }
}

// The one-shot seed runner (`spawnSeedRunner`) is GONE (plan 03 retirement):
// the seed is authored by the `guard-setup.seed` agent session in
// `@truecourse/core`, which reuses this package's SEED_SYSTEM_PROMPT doctrine
// and `buildSeedUserPrompt` grounding directly.

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
