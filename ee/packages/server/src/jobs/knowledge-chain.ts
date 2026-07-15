/**
 * Repo inheritance ripple — the successor to the retired workspace guard chain.
 *
 * After a workspace `knowledge.sync` (processing) job settles successfully AND the
 * corpus actually changed AND no spec conflict is left open, re-scan every connected
 * repo in the org: repos fold the workspace Knowledge layer into their own spec
 * before curate, so a changed workspace corpus means their inherited spec is stale.
 * The re-scan is `force` (the repo commit hasn't moved — only the inherited layer
 * did) and `quiet` (N repos must not each toast). A repo whose scan is already
 * running coalesces onto its pending-baseline buffer (replayed when that scan
 * settles), so nothing is lost.
 *
 * Two gates keep the ripple cheap and calm:
 *   - **changed-only** — the settling job compares the corpus content sha before and
 *     after; an unchanged process ripples nothing (repos already carry the layer).
 *   - **conflict-free only** — a process that leaves open conflicts keeps repos on
 *     the last clean spec (no inherited-open-conflict storm across N repos), the same
 *     `openConflicts === 0` gate the decision-write re-process uses.
 *
 * Best-effort: a failure is logged, never thrown into the completed process's
 * terminal path.
 */

import { log } from '@truecourse/core/lib/logger';
import type { JobOutcomeStatus } from './harness.js';
import type { SyncJobPayload, BaselineEnqueueRequest } from './constants.js';

/** One connected repo to re-scan — its baseline coordinates (the commit is unmoved). */
export interface RippleRepo {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  /** The repo's saved baseline commit — re-scanned in place (force). */
  commitSha: string;
}

export interface InheritanceRippleDeps {
  /** Open spec conflicts for the workspace corpus + decisions (0 when none / no corpus). */
  openConflicts(org: string): Promise<number>;
  /** The org's connected repos that have a baseline to re-scan. */
  listRepos(org: string): Promise<RippleRepo[]>;
  /** Coalescing baseline enqueue (null = coalesced onto the repo's pending buffer). */
  enqueueBaseline(req: BaselineEnqueueRequest): Promise<string | null>;
}

/** Returns the number of baselines freshly enqueued (coalesced losses excluded). */
export async function chainInheritanceRipple(
  deps: InheritanceRippleDeps,
  payload: SyncJobPayload,
  outcome: JobOutcomeStatus,
  result?: unknown,
): Promise<number> {
  if (outcome !== 'succeeded') return 0;
  // Nothing changed → repos already carry the current workspace layer; skip the
  // N-repo re-scan. `corpusChanged` is the before/after content-sha comparison the job did.
  if (!(result as { corpusChanged?: boolean } | undefined)?.corpusChanged) return 0;
  const { org } = payload;
  try {
    if ((await deps.openConflicts(org)) > 0) return 0;
    const repos = await deps.listRepos(org);
    let enqueued = 0;
    for (const repo of repos) {
      const jobId = await deps.enqueueBaseline({
        ...repo,
        workspaceOrgId: org,
        force: true,
        quiet: true,
      });
      if (jobId !== null) enqueued++;
    }
    return enqueued;
  } catch (err) {
    log.warn(`[ee-jobs] repo inheritance ripple failed for ${org}: ${(err as Error).message}`);
    return 0;
  }
}
