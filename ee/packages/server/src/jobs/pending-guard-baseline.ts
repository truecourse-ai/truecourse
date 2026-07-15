/**
 * Coalesce-then-rerun for guard baselines — the guard analogue of
 * `pending-baseline.ts`. `enqueueGuardBaseline` single-flights ONE baseline run
 * per repo (the `jobs` partial-unique key). A second refresh whose enqueue loses
 * that race (a rapid second merge, or the generate→baseline chain racing a merge)
 * is not dropped — it is recorded as the repo's pending follow-up (latest commit
 * wins) and replayed when the running baseline settles.
 *
 * The enqueue-or-pend + boot-drain halves delegate to the shared coalesce core
 * (see pending-coalesce.ts). `replayPendingGuardBaseline` is deliberately NOT
 * shared: unlike repo-baseline (which drops a same-commit pending unless `force`),
 * a guard baseline only actually settles its commit when it reached a verdict, so
 * a same-commit pending after a `no-verdict`/failed run must replay to self-heal a
 * transient build error (issue 06, story 12).
 *
 * Pure orchestration over the stores + an injected enqueue fn (graphile's
 * `addJob`), so the whole coalescing path is unit-testable without the worker.
 */

import type {
  JobStore,
  PendingGuardBaselineStore,
  PendingGuardBaselineView,
} from '@truecourse/ee-data-store';
import type { GuardBaselineResult } from '@truecourse/ee-github-app';
import { log } from '@truecourse/core/lib/logger';
import type { JobOutcomeStatus } from './harness.js';
import {
  GUARD_BASELINE_TASK,
  guardBaselineJobKey,
  type GuardBaselineEnqueueRequest,
  type GuardBaselineJobPayload,
} from './constants.js';
import { enqueueOrPendCoalesced, drainCoalesced } from './pending-coalesce.js';

/** Enqueue the graphile task once the tracked row exists (injected so the
 *  coalescing core is testable without graphile-worker). */
export type AddGuardBaselineJob = (
  jobId: string,
  req: GuardBaselineEnqueueRequest,
  jobKey: string,
) => Promise<void>;

export type EnqueueGuardBaseline = (
  req: GuardBaselineEnqueueRequest,
) => Promise<string | null>;

export interface GuardBaselineEnqueueDeps {
  jobStore: JobStore;
  pendingGuardBaselines: PendingGuardBaselineStore;
  addJob: AddGuardBaselineJob;
}

/**
 * How a settled guard-baseline run informs the replay decision: the terminal job
 * outcome + the pipeline verdict status (`null` when the job threw before one).
 * Threaded from the job body through the settle hook (mirrors how the job outcome
 * flows), so the replay can distinguish a run that actually settled its commit
 * from one that produced no verdict.
 */
export interface GuardBaselineSettleOutcome {
  outcome: JobOutcomeStatus;
  status: GuardBaselineResult['status'] | null;
}

function toRequest(p: PendingGuardBaselineView): GuardBaselineEnqueueRequest {
  return {
    repoFullName: p.repoFullName,
    installationId: p.installationId,
    defaultBranch: p.defaultBranch,
    commitSha: p.commitSha,
    workspaceOrgId: p.workspaceOrgId,
  };
}

/**
 * True when the settled run actually settled its commit with a verdict — a clean
 * run (`ok`) or a genuine nothing-to-run (`no-corpus`) — so a redundant same-commit
 * pending is obsolete and can be dropped. A `no-verdict` (build/run error) or a
 * thrown/failed run did NOT settle the commit, so its same-commit pending must
 * replay so the baseline can catch up to current main once the error clears.
 */
function settledWithVerdict(s: GuardBaselineSettleOutcome): boolean {
  return s.outcome === 'succeeded' && (s.status === 'ok' || s.status === 'no-corpus');
}

/**
 * Create the tracked guard-baseline job (one run per repo) and enqueue it. When a
 * run is already in flight for the repo, DON'T drop the request — record it as the
 * repo's pending follow-up (latest commit wins). Returns the new job id, or null
 * when it was coalesced onto the pending row.
 */
export async function enqueueOrPendGuardBaseline(
  deps: GuardBaselineEnqueueDeps,
  req: GuardBaselineEnqueueRequest,
): Promise<string | null> {
  return enqueueOrPendCoalesced(
    GUARD_BASELINE_TASK,
    guardBaselineJobKey,
    { jobStore: deps.jobStore, pending: deps.pendingGuardBaselines, addJob: deps.addJob },
    req,
  );
}

/**
 * A guard-baseline job for `payload.repoFullName` just went terminal, freeing its
 * single-flight key. Replay the repo's coalesced follow-up (recorded while that
 * job held the key), if any. A follow-up at a DIFFERENT commit always replays. A
 * redundant SAME-commit pending is dropped only when this run actually settled
 * that commit with a verdict (see {@link settledWithVerdict}); after a
 * `no-verdict` or a failed/thrown run the same-commit pending replays so a
 * transient build error self-heals. That replay is naturally bounded: the pending
 * buffer is filled only by NEW refresh requests that lost the freed key, so a
 * replayed run re-runs only if another refresh landed meanwhile — never an
 * unconditional self-requeue. Best-effort — never throws into the settling job's
 * terminal path.
 */
export async function replayPendingGuardBaseline(
  pendingGuardBaselines: PendingGuardBaselineStore,
  enqueue: EnqueueGuardBaseline,
  payload: GuardBaselineJobPayload,
  settled: GuardBaselineSettleOutcome,
): Promise<void> {
  try {
    const pending = await pendingGuardBaselines.take(payload.repoFullName);
    if (!pending) return;
    if (pending.commitSha === payload.commitSha && settledWithVerdict(settled)) return;
    await enqueue(toRequest(pending));
  } catch (err) {
    log.warn(
      `[ee-jobs] pending guard-baseline replay failed for ${payload.repoFullName}: ${(err as Error).message}`,
    );
  }
}

/**
 * Boot recovery: replay every pending follow-up left by a crash (no running job
 * survived to replay them). Per-row best-effort. Returns the count enqueued.
 */
export async function drainPendingGuardBaselines(
  pendingGuardBaselines: PendingGuardBaselineStore,
  enqueue: EnqueueGuardBaseline,
): Promise<number> {
  return drainCoalesced('guard-baseline', pendingGuardBaselines, toRequest, enqueue);
}
