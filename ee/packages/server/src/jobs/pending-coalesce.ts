/**
 * The shared coalesce-then-rerun core behind the repo-baseline and guard-baseline
 * pending buffers. Both single-flight ONE run per repo (the `jobs` partial-unique
 * key); a request that loses that race is not dropped but recorded as the repo's
 * pending follow-up (latest wins) and replayed when the running job settles.
 *
 * The two identical halves — the enqueue-or-pend on single-flight loss and the
 * boot-recovery drain — live here, parameterized over (task, job-key fn, store,
 * request mapper). The REPLAY half deliberately does NOT: repo-baseline drops a
 * redundant same-commit pending unless `force`, while guard-baseline (issue 06)
 * keys the drop on the run's own verdict, so each keeps its own `replay*` (see the
 * sibling modules). Pure orchestration over the stores + an injected `addJob`
 * (graphile's), so the whole path is unit-testable without the worker.
 */

import { ActiveJobExistsError, type JobStore } from '@truecourse/ee-data-store';
import { log } from '@truecourse/core/lib/logger';

/** The minimum a coalesced request carries: the repo it single-flights on + the
 *  workspace that scopes its job row. */
export interface CoalesceRequest {
  repoFullName: string;
  workspaceOrgId: string;
}

/** The pending-store surface the enqueue path needs (record the follow-up). */
export interface CoalescePendingUpsert<Req> {
  upsert(req: Req): Promise<void>;
}

export interface CoalesceEnqueueDeps<Req extends CoalesceRequest> {
  jobStore: JobStore;
  pending: CoalescePendingUpsert<Req>;
  /** Enqueue the graphile task once the tracked row exists. */
  addJob(jobId: string, req: Req, jobKey: string): Promise<void>;
}

/**
 * Create the tracked single-flight job (one run per repo) and enqueue it. When a
 * run is already in flight for the repo, DON'T drop the request — record it as the
 * repo's pending follow-up (latest wins). Returns the new job id, or null when it
 * was coalesced onto the pending row.
 */
export async function enqueueOrPendCoalesced<Req extends CoalesceRequest>(
  task: string,
  jobKey: (repoFullName: string) => string,
  deps: CoalesceEnqueueDeps<Req>,
  req: Req,
): Promise<string | null> {
  const key = jobKey(req.repoFullName);
  let job;
  try {
    job = await deps.jobStore.create({ org: req.workspaceOrgId, type: task, key });
  } catch (err) {
    if (err instanceof ActiveJobExistsError) {
      await deps.pending.upsert(req);
      return null;
    }
    throw err;
  }
  try {
    await deps.addJob(job.id, req, key);
  } catch (err) {
    // No graphile job exists to run (or settle) the row we just created — a
    // 'queued' row would hold the single-flight key until the next restart,
    // coalescing every request until then onto the pending buffer with no
    // running job to ever replay it. Mark the row terminal, then rethrow.
    await deps.jobStore.markFailed(job.id, (err as Error).message).catch(() => undefined);
    throw err;
  }
  return job.id;
}

/**
 * Boot recovery: replay every pending follow-up left by a crash (no running job
 * survived to replay them). Per-row best-effort. Returns the count enqueued.
 * `label` names the buffer in the log line.
 */
export async function drainCoalesced<Req, V extends { repoFullName: string }>(
  label: string,
  store: { drain(): Promise<V[]> },
  toRequest: (view: V) => Req,
  enqueue: (req: Req) => Promise<string | null>,
): Promise<number> {
  let count = 0;
  for (const row of await store.drain()) {
    try {
      await enqueue(toRequest(row));
      count += 1;
    } catch (err) {
      log.warn(
        `[ee-jobs] boot drain of pending ${label} ${row.repoFullName} failed: ${(err as Error).message}`,
      );
    }
  }
  return count;
}
