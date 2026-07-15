/**
 * Workspace guard chain — enqueue a `knowledge.guard` (scenario generate) after a
 * `knowledge.sync` (processing) job succeeds, iff no spec conflict is left open.
 * Processing just re-consolidated the workspace corpus, so this is the moment
 * scenario generation has its doc universe. With open conflicts the chain does
 * nothing (generation stays blocked); the decision-write path re-processes when the
 * last conflict resolves, whose settle then chains here.
 *
 * Best-effort: a failure is logged, never thrown into the completed process's
 * terminal path; the org-scoped single-flight `knowledge.guard:<org>` key makes a
 * double-enqueue a no-op (a coalesced enqueue returns null).
 */

import { log } from '@truecourse/core/lib/logger';
import type { JobOutcomeStatus } from './harness.js';
import type { SyncJobPayload } from './constants.js';

export interface WorkspaceGuardChainDeps {
  /** Open spec conflicts for the workspace corpus + decisions (the shared
   *  `openConflicts` derivation; 0 when there is no corpus yet). */
  openConflicts(org: string): Promise<number>;
  /** Single-flight workspace guard-generate enqueue (null = already running). */
  enqueueWorkspaceGuard(org: string): Promise<string | null>;
}

/** Returns the enqueued job id, or null when the chain (correctly) did nothing. */
export async function chainWorkspaceGuard(
  deps: WorkspaceGuardChainDeps,
  payload: SyncJobPayload,
  outcome: JobOutcomeStatus,
): Promise<string | null> {
  if (outcome !== 'succeeded') return null;
  const { org } = payload;
  try {
    if ((await deps.openConflicts(org)) > 0) return null;
    return await deps.enqueueWorkspaceGuard(org);
  } catch (err) {
    log.warn(`[ee-jobs] workspace guard chain failed for ${org}: ${(err as Error).message}`);
    return null;
  }
}
