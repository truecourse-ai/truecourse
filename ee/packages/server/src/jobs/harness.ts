/**
 * Job-definition harness — the single lifecycle + feedback envelope every
 * background job shares, so each job gets the identical experience by
 * construction instead of hand-wiring markRunning/notify/capture per task body.
 *
 * A {@link JobDefinition} supplies only the per-job bits: `type`, display `title`,
 * `steps`, the `run` body (which returns a result + success notification), the
 * failure `onError` wording, and the trace/sentry attribution. {@link executeJob}
 * owns everything else, identically for all jobs:
 *   - mark the `jobs` row running → succeeded/failed + the live SSE `job.progress`
 *   - seed the FULL step checklist (all pending) at start, so the popup shows the
 *     whole plan immediately, then advance it via `ctx.phase()`
 *   - carry the display `title` on every emitted event (the client never maps
 *     type→label)
 *   - post the standardized success/failure notification (durable feed + toast)
 *   - capture the failure to Sentry and re-throw (maxAttempts:1 ⇒ permanent fail)
 */

import type { EeDb } from '@truecourse/ee-db';
import type { JobStore, NotificationStore } from '@truecourse/ee-data-store';
import type { JobStep, JobView, NotificationLevel } from '@truecourse/shared';
import { JobStepTracker, type StepEmit } from './steps.js';
import { publishEvent } from './events.js';
import { captureEeException, type EeErrorContext } from '../observability/sentry.js';

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
 *  stay silent, e.g. the quiet workspace→repos ripple). */
export interface JobOutcome {
  result?: unknown;
  notification: JobNotification | null;
}

/** The world a job body runs in: its payload + the stepped-progress API. */
export interface JobContext<P> {
  payload: P;
  org: string;
  jobId: string;
  /** The tracker, for bridging OSS StepTrackers onto a step (stepBridge). */
  tracker: JobStepTracker;
  /** Advance the checklist to `key` (earlier steps auto-complete). */
  phase(key: string, detail?: string): Promise<void>;
  /** Update the active step's inline detail (e.g. a `3/12` counter). */
  detail(key: string, detail: string): Promise<void>;
}

/** Everything a job type declares — nothing else lives per task body. */
export interface JobDefinition<P extends { jobId: string }> {
  type: string;
  /** Human display title carried on the live event (client shows it verbatim). */
  title: string;
  steps: readonly StepDef[];
  /** Workspace org scoping the row, notifications, and trace. */
  org(payload: P): string;
  /** Optional trace enrichment (repo/commit); org + jobId are added by the caller. */
  traceMeta?(payload: P): { repoFullName?: string | null; commitSha?: string | null };
  /** Sentry attribution for a failure. */
  sentry(err: Error, payload: P): EeErrorContext;
  /** Do the work; return the row result + success notification (null = silent). */
  run(ctx: JobContext<P>): Promise<JobOutcome>;
  /** Failure notification wording (delivery + shape are identical for all jobs). */
  onError(err: Error, payload: P): JobNotification;
  /**
   * Optional side-effect run AFTER the row reaches its terminal state (succeeded
   * OR failed) and the notification is posted — so the single-flight key is now
   * free. The repo-baseline uses it to replay a coalesced follow-up push (both
   * outcomes) and to chain the guard onboarding (success only — hence the
   * `outcome` argument). It must be best-effort and not throw (a throw would mask
   * the job's own outcome); a failure still rethrows after it runs.
   */
  onSettled?(ctx: JobContext<P>, outcome: JobOutcomeStatus): Promise<void>;
}

/** How a job settled — handed to `onSettled` so success-only chains can key off it. */
export type JobOutcomeStatus = 'succeeded' | 'failed';

/** The stores the envelope needs — the same for every job. */
export interface JobRuntime {
  db: EeDb;
  jobStore: JobStore;
  notifications: NotificationStore;
}

/**
 * Run one job through the shared lifecycle. Extracted so it is unit-testable
 * without standing up graphile-worker; the graphile task wraps this in a trace
 * (see `registerJob` in worker.ts).
 */
export async function executeJob<P extends { jobId: string }>(
  rt: JobRuntime,
  def: JobDefinition<P>,
  payload: P,
): Promise<void> {
  const { jobId } = payload;
  const org = def.org(payload);

  // Every job.progress emit carries the display title + (optionally) the stepped
  // checklist. Steps ride the event only — never persisted on the row.
  const publishProgress = (job: JobView, steps?: JobStep[]): Promise<void> =>
    publishEvent(rt.db, org, {
      type: 'job.progress',
      job: { ...job, title: def.title, progress: steps ? { ...job.progress, steps } : job.progress },
    });

  const running = await rt.jobStore.markRunning(jobId);
  // Seed the whole plan (all pending) so the popup shows every upcoming step from
  // the start, not just steps that already ran.
  const seeded: JobStep[] = def.steps.map((s) => ({ key: s.key, label: s.label, status: 'pending' }));
  if (running) await publishProgress(running, seeded);

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
  };

  let failure: unknown = null;
  try {
    const outcome = await def.run(ctx);
    // Terminal job state first (clears the client's activeJobs), then the toast.
    const done = await rt.jobStore.markSucceeded(jobId, outcome.result ?? {});
    if (done) await publishProgress(done);
    if (outcome.notification) await postNotification(rt, org, def.type, jobId, outcome.notification);
  } catch (err) {
    const message = (err as Error).message;
    const failed = await rt.jobStore.markFailed(jobId, message);
    if (failed) await publishProgress(failed);
    await postNotification(rt, org, def.type, jobId, def.onError(err as Error, payload));
    captureEeException(err, def.sentry(err as Error, payload));
    failure = err;
  }

  // After terminal bookkeeping (row + notification) in BOTH paths, run the
  // optional settled hook — the single-flight key is now free, so e.g. the
  // baseline replays a coalesced follow-up push. A failure still rethrows after
  // (maxAttempts:1 ⇒ permanent fail, and graphile records it).
  await def.onSettled?.(ctx, failure ? 'failed' : 'succeeded');
  if (failure) throw failure;
}

async function postNotification(
  rt: JobRuntime,
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
  await publishEvent(rt.db, org, { type: 'notification', notification: note, jobId });
}
