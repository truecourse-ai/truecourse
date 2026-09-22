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
 * ONE RE-ASK PER LEAF, AND IT IS THE ENGINE'S WHERE THE ENGINE HAS ONE. The
 * match keeps its own corrective loop (it quotes the invalid answer back with
 * the catalog issues it found), so its session takes exactly one turn and
 * hands the RAW answer over, schema-valid or not — a shell repair stacked
 * under it would double the spend and hide the very output the engine quotes.
 * The claim diff and the world classification have no loop of their own, so
 * theirs is the shell's single schema repair.
 */

import type { SessionDriver, SessionPersistence } from '@truecourse/agent-loop'
import { z } from 'zod'
import {
  CLAIM_DIFF_SYSTEM_PROMPT,
  ClaimDiffSchema,
  MATCH_SYSTEM_PROMPT,
  RealizationMatchSchema,
  WORLD_CLASSIFY_SYSTEM_PROMPT,
  WorldClassifySchema,
  buildClaimDiffUserPrompt,
  buildMatchUserPrompt,
  buildWorldClassifyUserPrompt,
  type ClaimDiff,
  type ClaimDiffRunner,
  type MatchRunner,
  type WorldClassify,
  type WorldClassifyRunner,
} from '@truecourse/guard-generator'
import { createLeafSessionSeam, type LeafSessionSeam } from '../agent/leaf-session.js'
import { withOutcomeDelivery } from '../agent/one-turn.js'

export const MATCH_SESSION_KIND = 'guard-generate.match'
export const CLAIM_DIFF_SESSION_KIND = 'guard-generate.claim-diff'
export const WORLD_CLASSIFY_SESSION_KIND = 'guard-generate.world-classify'

/** The driver + journal a leaf session runs on, built on first use. */
export type AcquireLeafSession = () => Promise<{
  driver: SessionDriver
  persistence: SessionPersistence
}>

export interface LeafSessionSeams {
  matchRunner: MatchRunner
  claimDiffRunner: ClaimDiffRunner
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
  const claimDiff = seamFor(CLAIM_DIFF_SESSION_KIND)
  const worldClassify = seamFor(WORLD_CLASSIFY_SESSION_KIND)

  return {
    matchRunner: (ctx) =>
      match.ask<unknown>({
        session: {
          kind: MATCH_SESSION_KIND,
          title: 'Realization match',
          systemPrompt: withOutcomeDelivery(MATCH_SYSTEM_PROMPT),
          // The shape the model is asked for, and the raw answer handed back:
          // the engine validates and re-asks itself (see above).
          outcomeSchema: z.unknown(),
          outcomeInputSchema: RealizationMatchSchema,
          reasks: 0,
          tokenCeiling: 200_000,
        },
        // A re-ask after an invalid answer is a separate ask about the same
        // pair — the work item says which, so the run reads honestly.
        workItem: `${ctx.flow.id}:${ctx.surface}${ctx.correction ? ' (re-ask)' : ''}`,
        briefing: buildMatchUserPrompt(ctx),
      }),

    claimDiffRunner: (section) =>
      claimDiff.ask<ClaimDiff>({
        session: {
          kind: CLAIM_DIFF_SESSION_KIND,
          title: 'Claim diff',
          systemPrompt: withOutcomeDelivery(CLAIM_DIFF_SYSTEM_PROMPT),
          outcomeSchema: ClaimDiffSchema,
          tokenCeiling: 100_000,
        },
        workItem: `${section.doc}#${section.anchor}`,
        briefing: buildClaimDiffUserPrompt(section),
      }),

    worldClassifyRunner: (flows) =>
      worldClassify.ask<WorldClassify>({
        session: {
          kind: WORLD_CLASSIFY_SESSION_KIND,
          title: 'World classification',
          systemPrompt: withOutcomeDelivery(WORLD_CLASSIFY_SYSTEM_PROMPT),
          outcomeSchema: WorldClassifySchema,
          tokenCeiling: 100_000,
        },
        workItem: `${flows.length} flow${flows.length === 1 ? '' : 's'}`,
        briefing: buildWorldClassifyUserPrompt(flows),
      }),

    summaries: () => [match.summary(), claimDiff.summary(), worldClassify.summary()],
  }
}
