/**
 * GUARD GENERATE'S LEAF JUDGEMENTS — the realization match, the claim-diff gate
 * and the world classification, each as a ONE-TURN SESSION.
 *
 * They have nothing to explore: the engine hands each one everything it needs
 * and wants one structured answer back. What changed is only WHERE the answer
 * comes from — every loop, cache and fail-open rule around them is still the
 * engine's, and each still answers the runner signature
 * (`@truecourse/guard-generator`) the engine has always called.
 *
 * THE PROMPTS ARE THE ENGINE'S, VERBATIM. Each stage's system prompt and
 * briefing builder are imported, not restated, and the outcome instruction is
 * APPENDED rather than folded in — so the prompt fingerprint each stage caches
 * under still names the prompt it always did, and a repo's warm cache survives
 * the move.
 *
 * THE MATCH CATALOG RIDES THE SYSTEM PROMPT, after the matching instructions,
 * so it is the prefix every match against one surface shares. Providers cache
 * by prefix: each flow's obligations, fixtures and corrections arrive in the
 * user turn, after it, and separate sessions reuse the catalog.
 *
 * ONE RE-ASK PER LEAF, AND IT IS THE ENGINE'S WHERE THE ENGINE HAS ONE. The
 * match keeps its own corrective loop (it quotes the invalid answer back with
 * the catalog issues it found), so its session takes exactly one turn and
 * hands the RAW answer over, schema-valid or not — a shell repair stacked
 * under it would double the spend and hide the very output the engine quotes.
 * The claim diff and the world classification have no loop of their own, so
 * theirs is the shell's single schema repair.
 */

import { defineSessionKind, type SessionDriver, type SessionPersistence } from '@truecourse/agent-loop'
import { z } from 'zod'
import {
  MATCH_SYSTEM_PROMPT,
  RealizationMatchSchema,
  WORLD_CLASSIFY_SYSTEM_PROMPT,
  WorldClassifySchema,
  buildMatchCatalogPrompt,
  buildMatchTaskPrompt,
  buildWorldClassifyUserPrompt,
  type MatchRunner,
  type WorldClassify,
  type WorldClassifyRunner,
} from '@truecourse/guard-generator'
import { createLeafSessionSeam, type LeafSessionSeam } from '../agent/leaf-session.js'
import { withOutcomeDelivery } from '../agent/one-turn.js'

export const MATCH_SESSION_KIND = 'guard-generate.match'
export const WORLD_CLASSIFY_SESSION_KIND = 'guard-generate.world-classify'

const MATCH_SESSION = defineSessionKind({
  kind: MATCH_SESSION_KIND,
  // The shape the model is asked for, and the raw answer handed back: the
  // engine validates and re-asks itself (see above).
  outcomeSchema: z.unknown(),
  outcomeInputSchema: RealizationMatchSchema,
})
const WORLD_CLASSIFY_SESSION = defineSessionKind({ kind: WORLD_CLASSIFY_SESSION_KIND, outcomeSchema: WorldClassifySchema })

/** The driver + journal a leaf session runs on, built on first use. */
export type AcquireLeafSession = () => Promise<{
  driver: SessionDriver
  persistence: SessionPersistence
}>

export interface LeafSessionSeams {
  matchRunner: MatchRunner
  worldClassifyRunner: WorldClassifyRunner
  /** What each leaf kind did — folded into the run's LLM-failure accounting. */
  summaries(): readonly ReturnType<LeafSessionSeam['summary']>[]
}

export interface CreateLeafSessionsOptions {
  acquire: AcquireLeafSession
  onSessionEvent?: (workItem: string, event: import('@truecourse/agent-loop').SessionEvent) => void
  signal?: AbortSignal
  mintSessionId?: () => string
}

export function createGuardGenerateLeafSessions(opts: CreateLeafSessionsOptions): LeafSessionSeams {
  const seamFor = (kind: string): LeafSessionSeam =>
    createLeafSessionSeam({
      kind,
      acquire: opts.acquire,
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
    })

  const match = seamFor(MATCH_SESSION_KIND)
  const worldClassify = seamFor(WORLD_CLASSIFY_SESSION_KIND)

  return {
    matchRunner: (ctx) =>
      match.ask<unknown>({
        session: {
          ...MATCH_SESSION,
          title: 'Realization match',
          // The catalog is identical across this surface's matches. Give it
          // the system cache boundary; per-flow text must not precede it.
          systemPrompt: `${withOutcomeDelivery(MATCH_SYSTEM_PROMPT)}\n\n${buildMatchCatalogPrompt(ctx)}`,
          reasks: 0,
          tokenCeiling: 200_000,
        },
        // A re-ask after an invalid answer is a separate ask about the same
        // pair — the work item says which, so the run reads honestly.
        workItem: `${ctx.flow.id}:${ctx.surface}${ctx.correction ? ' (re-ask)' : ''}`,
        briefing: buildMatchTaskPrompt(ctx),
      }),

    worldClassifyRunner: (flows) =>
      worldClassify.ask<WorldClassify>({
        session: {
          ...WORLD_CLASSIFY_SESSION,
          title: 'World classification',
          systemPrompt: withOutcomeDelivery(WORLD_CLASSIFY_SYSTEM_PROMPT),
          tokenCeiling: 100_000,
        },
        workItem: `${flows.length} flow${flows.length === 1 ? '' : 's'}`,
        briefing: buildWorldClassifyUserPrompt(flows),
      }),

    summaries: () => [match.summary(), worldClassify.summary()],
  }
}
