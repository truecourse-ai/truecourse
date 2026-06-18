/**
 * The workspace→repos re-verify fan-out. When a workspace's contracts change
 * (KB sync / workspace decision), every connected repo's EFFECTIVE contracts
 * (workspace ∪ repo) change too — so each must be re-verified against the new
 * set. We don't regenerate repo contracts (the merge is at verify time); we just
 * re-run the baseline, FORCED (the repo head is unchanged, so the normal "already
 * baselined this commit" skip would block it) and QUIET (one sync re-verifying N
 * repos must not fan out N success toasts).
 *
 * Pure orchestration over the gate store + an enqueue fn, so it's unit-testable
 * without standing up the worker.
 */

import type { GateStore } from '@truecourse/ee-github-app';
import type { BaselineEnqueueRequest } from './constants.js';

export type EnqueueBaseline = (req: BaselineEnqueueRequest) => Promise<string | null>;

/**
 * Re-verify every connected repo in `workspaceOrgId`. The commit comes from each
 * repo's existing baseline (its last-verified head); a repo never scanned (no
 * baseline) is skipped. Returns the count actually enqueued — `enqueueBaseline`
 * returns null when a baseline for that repo is already in flight (single-flight).
 */
export async function reverifyWorkspaceRepos(
  gateStore: GateStore,
  enqueueBaseline: EnqueueBaseline,
  workspaceOrgId: string,
): Promise<number> {
  const repos = await gateStore.listReposForWorkspace(workspaceOrgId);
  let count = 0;
  for (const repo of repos) {
    const baseline = await gateStore.getBaseline(repo.repoFullName);
    if (!baseline) continue; // never scanned → no head commit to re-verify against
    const jobId = await enqueueBaseline({
      repoFullName: repo.repoFullName,
      installationId: repo.installationId,
      defaultBranch: repo.defaultBranch,
      commitSha: baseline.commitSha,
      workspaceOrgId,
      force: true,
      quiet: true,
    });
    if (jobId) count += 1;
  }
  return count;
}
