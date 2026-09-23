/**
 * THE LEAF SEAMS — the four one-question judgements `generateGuards` and
 * `runGuardSetup` ask the model, declared here and implemented in
 * `@truecourse/core` as ONE-TURN SESSIONS.
 *
 * This package holds the deterministic spine: it builds each question's
 * briefing from its own prompts, decides when to ask it, caches the answer, and
 * validates what comes back. It does not know how the answer is obtained, which
 * is why these are function types and not a model client — the engine cannot
 * depend on the package that owns the session driver.
 *
 * A runner answers with the model's raw structured value (`unknown`, which the
 * engine then validates), or THROWS naming why there is none. Every loop,
 * cache and fail-open rule around a runner is the engine's.
 */

import type { GuardSessionSummary } from './extract.js'
import type {
  ClaimDiffSectionInput,
  MatchUserContext,
  RecipeDiscoveryInput,
  WorldClassifyFlowInput,
} from './prompts.js'

/** The session kinds the leaf judgements run as — named here because this is
 *  where the engine reports them, and read by the implementation in core. */
export const RECIPE_PROPOSE_SESSION_KIND = 'guard-setup.recipe-propose'
export const MATCH_SESSION_KIND = 'guard-generate.match'
export const CLAIM_DIFF_SESSION_KIND = 'guard-generate.claim-diff'
export const WORLD_CLASSIFY_SESSION_KIND = 'guard-generate.world-classify'

/** Recipe discovery — one ask per repository whose recipe is not settled yet. */
export type RecipeRunner = (input: RecipeDiscoveryInput) => Promise<unknown>

/** Realization matching — one ask per (flow, surface with a non-empty catalog). */
export type MatchRunner = (input: MatchUserContext) => Promise<unknown>

/** World classification — ONE batched ask per generate over the changed flows,
 *  deciding which workers the pool schedules into the mutator tail. */
export type WorldClassifyRunner = (flows: readonly WorldClassifyFlowInput[]) => Promise<unknown>

/** The claim-diff gate — one ask per EDITED section whose doc has a prior
 *  extraction, deciding whether the edit changed any obligation. */
export type ClaimDiffRunner = (section: ClaimDiffSectionInput) => Promise<unknown>

/**
 * What the leaf kinds did across this run, read at every exit: the same
 * per-kind summaries the pooled session kinds report, so a leaf that lost every
 * one of its sessions to the provider stops the run through the one channel
 * that already exists for that.
 */
export type LeafSummaries = () => readonly GuardSessionSummary[]
