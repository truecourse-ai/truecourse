/**
 * THE RECIPE PROPOSAL — one turn, one session.
 *
 * Asked once per repository whose recipe is not settled yet: read the manifest
 * files, propose how to build and start the thing. It runs nothing and reads
 * nothing else — the engine verifies the proposal by BUILDING it — so it is a
 * single structured answer, and that is what a one-turn session is.
 *
 * When it fails, `guard setup`'s `recipe-repair` session takes over: a full
 * agent loop in a live sandbox. This is the cheap first ask; that is the
 * expensive second one.
 *
 * The prompt and the briefing are the engine's own, verbatim, so the fingerprint
 * the recipe cache keys on still names the prompt it always did.
 */

import {
  RECIPE_SYSTEM_PROMPT,
  RecipeProposalSchema,
  buildRecipeUserPrompt,
  type RecipeProposal,
  type RecipeRunner,
} from '@truecourse/guard-generator'
import { createLeafSessionSeam, type LeafSessionContext, type LeafSessionSeam } from '../agent/leaf-session.js'
import { withOutcomeDelivery } from '../agent/one-turn.js'

export const RECIPE_PROPOSE_SESSION_KIND = 'guard-setup.recipe-propose'

export interface RecipeProposeSeam {
  runner: RecipeRunner
  summary: LeafSessionSeam['summary']
}

export interface CreateRecipeProposeOptions {
  acquire: () => Promise<LeafSessionContext>
  onSessionEvent?: (workItem: string, event: import('@truecourse/agent-loop').SessionEvent) => void
  signal?: AbortSignal
  mintSessionId?: () => string
  onSpend?: (spent: { turns: number; tokens: number; costUsd: number }) => void
}

export function createRecipeProposeSession(opts: CreateRecipeProposeOptions): RecipeProposeSeam {
  const seam = createLeafSessionSeam({
    kind: RECIPE_PROPOSE_SESSION_KIND,
    acquire: opts.acquire,
    ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
    ...(opts.onSpend ? { onSpend: opts.onSpend } : {}),
  })
  return {
    runner: (input) =>
      seam.ask<RecipeProposal>({
        session: {
          kind: RECIPE_PROPOSE_SESSION_KIND,
          title: 'Recipe proposal',
          systemPrompt: withOutcomeDelivery(RECIPE_SYSTEM_PROMPT),
          outcomeSchema: RecipeProposalSchema,
          tokenCeiling: 150_000,
        },
        // A retry after a failed verification, and a re-ask after an invalid
        // answer, are separate asks about the same repository — the work item
        // says which, so the run reads honestly.
        workItem: input.retry ? 'recipe (retry)' : input.correction ? 'recipe (re-ask)' : 'recipe',
        briefing: buildRecipeUserPrompt(input),
      }),
    summary: seam.summary,
  }
}
