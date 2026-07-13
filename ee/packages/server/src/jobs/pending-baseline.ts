/**
 * Coalesce-then-rerun for repo baselines. `enqueueBaseline` single-flights ONE
 * scan per repo (the `jobs` partial-unique key). A second default-branch push
 * whose enqueue loses that race used to be dropped — its contract carry-over
 * silently lost until some unrelated future push. Instead we record it as the
 * repo's pending follow-up (latest commit wins) and replay it exactly once, at
 * the NEWEST requested commit, when the running scan settles.
 *
 * Deliberately NOT per-commit job keys: if C2 arrives while C1 runs, C1's result
 * is already obsolete — we want a single follow-up run at C2, not one per commit.
 *
 * Pure orchestration over the stores + an enqueue fn (graphile's `addJob` is
 * injected), so the whole coalescing path is unit-testable without the worker.
 */

import { ActiveJobExistsError } from '@truecourse/ee-data-store';
import type { JobStore, PendingBaselineStore, PendingBaselineView } from '@truecourse/ee-data-store';
import { log } from '@truecourse/core/lib/logger';
import { REPO_BASELINE_TASK, baselineJobKey, type BaselineEnqueueRequest } from './constants.js';
import type { BaselineJobPayload, EnqueueBaseline } from './constants.js';

/** Enqueue the graphile task once the tracked row exists (injected so the
 *  coalescing core is testable without graphile-worker). */
export type AddBaselineJob = (
  jobId: string,
  req: BaselineEnqueueRequest,
  jobKey: string,
) => Promise<void>;

export interface BaselineEnqueueDeps {
  jobStore: JobStore;
  pendingBaselines: PendingBaselineStore;
  addJob: AddBaselineJob;
}

function toRequest(p: PendingBaselineView): BaselineEnqueueRequest {
  return {
    repoFullName: p.repoFullName,
    installationId: p.installationId,
    defaultBranch: p.defaultBranch,
    commitSha: p.commitSha,
    workspaceOrgId: p.workspaceOrgId,
    force: p.force,
    quiet: p.quiet,
  };
}

/**
 * Create the tracked baseline job (one scan per repo) and enqueue it. When a scan
 * is already in flight for the repo, DON'T drop the request — record it as the
 * repo's pending follow-up (latest commit wins). Returns the new job id, or null
 * when it was coalesced onto the pending row.
 */
export async function enqueueOrPendBaseline(
  deps: BaselineEnqueueDeps,
  req: BaselineEnqueueRequest,
): Promise<string | null> {
  const key = baselineJobKey(req.repoFullName);
  let job;
  try {
    job = await deps.jobStore.create({ org: req.workspaceOrgId, type: REPO_BASELINE_TASK, key });
  } catch (err) {
    if (err instanceof ActiveJobExistsError) {
      await deps.pendingBaselines.upsert(req);
      return null;
    }
    throw err;
  }
  await deps.addJob(job.id, req, key);
  return job.id;
}

/**
 * A baseline job for `payload.repoFullName` just went terminal, freeing its
 * single-flight key. Replay the repo's coalesced follow-up (recorded while that
 * job held the key), if any — but only when it targets a DIFFERENT commit, or a
 * re-baseline of the same commit was explicitly requested (force); a redundant
 * same-commit pending is obsolete and dropped. A normal enqueue: it may itself
 * re-pend if another push won the freed key in between, which is correct.
 * Best-effort — never throws into the job's terminal path.
 */
export async function replayPendingBaseline(
  pendingBaselines: PendingBaselineStore,
  enqueue: EnqueueBaseline,
  payload: BaselineJobPayload,
): Promise<void> {
  try {
    const pending = await pendingBaselines.take(payload.repoFullName);
    if (!pending) return;
    if (pending.commitSha === payload.commitSha && !pending.force) return;
    await enqueue(toRequest(pending));
  } catch (err) {
    log.warn(
      `[ee-jobs] pending-baseline replay failed for ${payload.repoFullName}: ${(err as Error).message}`,
    );
  }
}

/**
 * Boot recovery: replay every pending follow-up left by a crash (no running job
 * survived to replay them). Per-row best-effort. Returns the count enqueued.
 */
export async function drainPendingBaselines(
  pendingBaselines: PendingBaselineStore,
  enqueue: EnqueueBaseline,
): Promise<number> {
  let count = 0;
  for (const row of await pendingBaselines.drain()) {
    try {
      await enqueue(toRequest(row));
      count += 1;
    } catch (err) {
      log.warn(
        `[ee-jobs] boot drain of pending baseline ${row.repoFullName} failed: ${(err as Error).message}`,
      );
    }
  }
  return count;
}
