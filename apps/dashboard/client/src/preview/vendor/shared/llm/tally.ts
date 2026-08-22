// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's packages/shared/src/llm/tally.ts; delete with the preview.
/**
 * Per-stage LLM transport accounting, the run-level record of how many calls a
 * pipeline stage sent to the transport and how many of them FAILED (the call
 * threw: no answer at all). Kept node-free so the guard report schema can reuse
 * the shape without dragging the transport's `node:child_process` into a browser
 * bundle; the wrapper that produces it lives in `transport.ts` (`auditTransport`).
 *
 * A failure here is strictly a TRANSPORT failure. A call that returned text the
 * caller then failed to parse or Zod-validate is a successful attempt, those
 * have their own per-stage handling (re-asks, fail-soft records).
 */

import { z } from 'zod';

export const StageTransportTallySchema = z
  .object({
    /** Pipeline stage id, e.g. `spec.relevance` / `guard.extract`. */
    stage: z.string(),
    /** Calls that reached the transport. Cache hits never do, so they never count. */
    attempts: z.number().int().nonnegative(),
    /** Attempts that threw, no answer. Parse/validation failures are NOT counted. */
    failures: z.number().int().nonnegative(),
    /** The first failure's message, so a report can say WHY, not just how many. */
    firstError: z.string().optional(),
  })
  .strict();

export type StageTransportTally = z.infer<typeof StageTransportTallySchema>;

/** Cap on a recorded failure message, enough to identify it, bounded in JSON. */
export const MAX_TALLY_ERROR_CHARS = 500;

/** A stage where calls were attempted and every one of them failed. */
export function isSystemicTally(tally: StageTransportTally | undefined): boolean {
  return !!tally && tally.attempts > 0 && tally.failures === tally.attempts;
}

/**
 * Every LLM call in one stage failed, so the stage produced nothing. Thrown by the
 * pipelines that would otherwise fail open per item and record total failure as a
 * clean, empty success (see `spec-consolidator`'s `curate`); carries the stage
 * tally so a surface can render the counts and the underlying error.
 */
export class LlmStageFailureError extends Error {
  constructor(public readonly tally: StageTransportTally) {
    super(formatStageFailure(tally));
    this.name = 'LlmStageFailureError';
  }
}

/** The one-line-plus-cause message every surface shows for a systemic failure. */
export function formatStageFailure(tally: StageTransportTally): string {
  const head = `every LLM call in the \`${tally.stage}\` stage failed (${tally.failures} of ${tally.attempts}), the stage produced nothing`;
  return tally.firstError ? `${head}. First failure: ${tally.firstError}` : head;
}
