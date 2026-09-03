/**
 * Job-definition harness — the single lifecycle + feedback envelope every
 * background job shares, so each job gets the identical experience by
 * construction instead of hand-wiring markRunning/notify/capture per task body.
 *
 * A {@link JobDefinition} supplies only the per-job bits: `type`, display `title`,
 * `steps`, the `run` body (which returns a result + success notification), the
 * failure `onError` wording, and its trace/error attribution. {@link executeJob}
 * owns everything else, identically for all jobs:
 *   - mark the `jobs` row running → succeeded/failed/cancelled + the live
 *     `job.progress` event
 *   - seed the FULL step checklist (all pending) at start, so the popup shows the
 *     whole plan immediately, then advance it via `ctx.phase()`
 *   - carry the display `title` on every emitted event (the client never maps
 *     type→label)
 *   - post the standardized success/failure notification (durable feed + toast)
 *   - report the failure through the runtime's `onException` seam and re-throw
 *
 * Cancellation is a first-class outcome, not a failure: a job cancelled while
 * queued never runs its body, and one aborted mid-run settles `cancelled` with
 * no error and no notification — nobody is waiting to be told about work they
 * stopped themselves.
 */

import type { Db } from '@truecourse/db';
import type { JobStore, NotificationStore } from '@truecourse/data-store';
import type { JobStep, JobView, NotificationLevel, ServerEvent } from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';
import { JobStepTracker, type StepEmit } from './steps.js';

/** The minimum every job payload carries: the tracked row it settles. */
export interface JobPayload {
  jobId: string;
}

/** A single phase in a job's stepped checklist. */
export interface StepDef {
  key: string;
  label: string;
}

/** A notification the harness posts (durable feed + live toast). `jobId` is added
 *  by the harness — definitions supply only their own `data`. */
export interface JobNotification {
  level: NotificationLevel;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** What a job body returns: the row result + the success notification (or null to
 *  stay silent, e.g. a quiet internal ripple). */
export interface JobOutcome {
  result?: unknown;
  notification: JobNotification | null;
}

/** How a job settled — handed to `onSettled` so outcome-keyed chains can branch. */
export type JobOutcomeStatus = 'succeeded' | 'failed' | 'cancelled';

/** The world a job body runs in: its payload + the stepped-progress API. */
export interface JobContext<P> {
  payload: P;
  org: string;
  jobId: string;
  /** The tracker, for bridging core StepTrackers onto a step (stepBridge). */
  tracker: JobStepTracker;
  /** Advance the checklist to `key` (earlier steps auto-complete). */
  phase(key: string, detail?: string): Promise<void>;
  /** Update the active step's inline detail (e.g. a `3/12` counter). */
  detail(key: string, detail: string): Promise<void>;
  /**
   * Cancellation for the body's long-running work — a user cancel (disconnect,
   * supersede) or a worker shutdown. Bodies that spawn children or run pipelines
   * thread it down so a stop doesn't leave work running headless.
   */
  signal?: AbortSignal;
}

/**
 * Everything a job type declares — nothing else lives per task body. `M` is the
 * shape of the error attribution the runtime's `onException` consumes; it
 * defaults to a plain bag for runtimes that report failures generically.
 */
export interface JobDefinition<P extends JobPayload, M = Record<string, unknown>> {
  type: string;
  /** Human display title carried on the live event (client shows it verbatim). */
  title: string;
  steps: readonly StepDef[];
  /** Workspace org scoping the row, notifications, and trace. */
  org(payload: P): string;
  /** Optional trace enrichment (repo/commit); org + jobId are added by the caller. */
  traceMeta?(payload: P): { repoFullName?: string | null; commitSha?: string | null };
  /** Attribution handed to the runtime's `onException` for a failure. */
  errorMeta?(err: Error, payload: P): M;
  /** Do the work; return the row result + success notification (null = silent). */
  run(ctx: JobContext<P>): Promise<JobOutcome>;
  /** Failure notification wording (delivery + shape are identical for all jobs). */
  onError(err: Error, payload: P): JobNotification;
  /**
   * Optional side-effect run AFTER the row reaches its terminal state (succeeded,
   * failed OR cancelled) and the notification is posted — so the single-flight
   * key is now free. Used to replay a coalesced follow-up request (any outcome)
   * and to chain a downstream job (success only — hence the `outcome` argument).
   * `result` is what the run body returned on success (undefined otherwise), so a
   * settle hook can key off the run's own outcome detail. It must be best-effort
   * and not throw (a throw would mask the job's own outcome); a failure still
   * rethrows after it runs.
   */
  onSettled?(ctx: JobContext<P>, outcome: JobOutcomeStatus, result?: unknown): Promise<void>;
}

/** The collaborators the envelope needs — the same for every job. */
export interface JobRuntime<M = Record<string, unknown>> {
  db: Db;
  jobStore: JobStore;
  notifications: NotificationStore;
  /** Push a live event to the workspace's subscribers (best-effort). */
  publish(org: string, event: ServerEvent): Promise<void>;
  /**
   * Report a job failure to whatever the deployment watches (Sentry in the
   * hosted edition). `meta` is the definition's `errorMeta`, undefined when it
   * declares none.
   */
  onException?(err: unknown, meta: M | undefined): void;
}

/**
 * Run one job through the shared lifecycle. Extracted so it is unit-testable
 * without standing up graphile-worker; the graphile task wraps this in a trace
 * (see `registerJob` in worker.ts).
 */
export async function executeJob<P extends JobPayload, M>(
  rt: JobRuntime<M>,
  def: JobDefinition<P, M>,
  payload: P,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const { jobId } = payload;
  const org = def.org(payload);

  // Every job.progress emit carries the display title + (optionally) the stepped
  // checklist. Steps ride the event only — never persisted on the row.
  const publishProgress = (job: JobView, steps?: JobStep[]): Promise<void> =>
    rt.publish(org, {
      type: 'job.progress',
      job: { ...job, title: def.title, progress: steps ? { ...job.progress, steps } : job.progress },
    });

  // Claiming the row is also the cancel check: a job cancelled (or reaped) while
  // queued is no longer claimable, and its body must never run.
  const running = await rt.jobStore.markRunning(jobId);
  if (!running) {
    // Cancelled or reaped while queued — or a payload addressing the wrong row.
    // Either way the graphile job is consumed here, so say so.
    log.info(`[jobs] ${def.type} ${jobId}: row is not queued — skipping the body`);
    return;
  }
  // Seed the whole plan (all pending) so the popup shows every upcoming step from
  // the start, not just steps that already ran.
  const seeded: JobStep[] = def.steps.map((s) => ({ key: s.key, label: s.label, status: 'pending' }));
  await publishProgress(running, seeded);

  const emit: StepEmit = async (snap) => {
    const job = await rt.jobStore.setProgress(jobId, {
      current: snap.current,
      total: snap.total,
      message: snap.message,
    });
    if (job) await publishProgress(job, snap.steps);
  };
  const tracker = new JobStepTracker([...def.steps], emit);
  const ctx: JobContext<P> = {
    payload,
    org,
    jobId,
    tracker,
    phase: (key, detail) => tracker.advance(key, detail),
    detail: (key, detail) => tracker.detail(key, detail),
    signal: opts.signal,
  };

  let failure: unknown = null;
  let runResult: unknown = undefined;
  let outcomeStatus: JobOutcomeStatus = 'succeeded';
  // A stop the user asked for settles quietly: no error text, no toast, nothing
  // reported, and no result for the settled hook to chain off — whether the body
  // unwound on the abort or ran to completion despite it.
  const settleCancelled = async (): Promise<void> => {
    outcomeStatus = 'cancelled';
    runResult = undefined;
    const cancelled = await rt.jobStore.markCancelled(jobId);
    if (cancelled) await publishProgress(cancelled);
  };

  try {
    const outcome = await def.run(ctx);
    runResult = outcome.result;
    if (opts.signal?.aborted) {
      await settleCancelled();
    } else {
      // Terminal job state first (clears the client's activeJobs), then the toast.
      const done = await rt.jobStore.markSucceeded(jobId, outcome.result ?? {});
      if (done) await publishProgress(done);
      if (outcome.notification)
        await postNotification(rt, org, def.type, jobId, outcome.notification);
    }
  } catch (err) {
    if (opts.signal?.aborted) {
      await settleCancelled();
    } else {
      outcomeStatus = 'failed';
      const message = (err as Error).message;
      const failed = await rt.jobStore.markFailed(jobId, message);
      if (failed) await publishProgress(failed);
      await postNotification(rt, org, def.type, jobId, def.onError(err as Error, payload));
      rt.onException?.(err, def.errorMeta?.(err as Error, payload));
      failure = err;
    }
  }

  // After terminal bookkeeping (row + notification) in EVERY path, run the
  // optional settled hook — the single-flight key is now free, so e.g. a
  // coalesced follow-up can replay. It sees the run's own result (undefined
  // unless the run succeeded). A failure still rethrows after (jobs run with
  // maxAttempts:1 ⇒ permanent fail, and graphile records it).
  await def.onSettled?.(ctx, outcomeStatus, runResult);
  if (failure) throw failure;
}

async function postNotification<M>(
  rt: JobRuntime<M>,
  org: string,
  kind: string,
  jobId: string,
  n: JobNotification,
): Promise<void> {
  const note = await rt.notifications.add({
    org,
    kind,
    level: n.level,
    title: n.title,
    body: n.body,
    data: { jobId, ...n.data },
  });
  await rt.publish(org, { type: 'notification', notification: note, jobId });
}
