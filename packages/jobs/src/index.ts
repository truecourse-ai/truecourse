/**
 * The background job runner: a Postgres-backed queue (graphile-worker) with a
 * tracked row per job, a live event stream, and a durable notifications feed.
 *
 * `createJobs` assembles the whole thing from a task list and hands back the
 * enqueue/cancel surface plus three routers to mount:
 *   - GET  /events            — the per-workspace SSE stream
 *   - GET  /jobs[?active=1]   — job status (seeds the UI's in-flight state)
 *   - GET/POST /notifications — the durable feed + read-state
 *
 * Enqueues are single-flight per `key`: one active job per (workspace, key), so
 * a redelivered webhook, a double click or a chain race never queues a
 * duplicate. A cancel stops the run when it is happening in this process and
 * settles the row `cancelled`; cancellation is a normal outcome, not a failure,
 * so it records no error and posts no notification.
 */

import type { Db } from '@truecourse/db';
import {
  ActiveJobExistsError,
  JobStore,
  NotificationStore,
  type OrphanedJob,
} from '@truecourse/data-store';
import { isActiveJob, type ServerEvent } from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';
import type { Router } from 'express';
import type { Runner } from 'graphile-worker';
import { EventHub, publishEvent, type EventBackplane } from './events.js';
import type { JobRuntime } from './harness.js';
import {
  cancelLocalJob,
  isJobRunningLocally,
  startWorker as defaultStartWorker,
  type JobTask,
  type StartWorker,
} from './worker.js';
import {
  createEventsRouter,
  createJobsRouter,
  createNotificationsRouter,
  orgIdFromUser,
  type OrgIdOf,
} from './routes.js';

export interface CreateJobsOptions<M = Record<string, unknown>> {
  db: Db;
  /** Postgres URL for graphile-worker's own pool and the LISTEN connection. */
  connectionString: string;
  /** Every job type this process can run. */
  tasks: readonly JobTask<M>[];
  /** Max jobs in flight per process (graphile's own concurrency). Default 2. */
  concurrency?: number;
  /** How a route learns the caller's workspace. Defaults to the auth gate's user. */
  orgIdOf?: OrgIdOf;
  /**
   * The jobs a restart abandoned, handed over at `start()` after they were
   * reaped — a chance to settle side effects the dead runs left dangling.
   */
  onReaped?(jobs: OrphanedJob[]): Promise<void>;
  /** Where a job failure is reported (Sentry in the hosted edition). */
  onException?(err: unknown, meta: M | undefined): void;
  /** The live backplane. Defaults to a Postgres LISTEN/NOTIFY hub. */
  hub?: EventBackplane;
  /** How the worker runner is started. Substituted in tests. */
  startWorker?: StartWorker<M>;
}

/** What a cancel could do: it stopped the job, the job runs on another replica
 *  (row cancelled, work keeps going there), or there was nothing active. */
export type CancelResult = 'cancelled' | 'not-here' | 'absent';

export interface Jobs {
  jobStore: JobStore;
  notifications: NotificationStore;
  hub: EventBackplane;
  /**
   * Create the tracked row and enqueue the task. Returns the new job id, or null
   * when `key` is already held by an active job (single-flight loss).
   */
  singleFlightEnqueue(
    task: string,
    org: string,
    key: string,
    payload: Record<string, unknown>,
  ): Promise<string | null>;
  /** Enqueue without the tracked-row bookkeeping (the row must already exist). */
  addJob(task: string, payload: Record<string, unknown>, jobKey: string): Promise<void>;
  /** Stop an active job: abort it if it runs here, and settle the row cancelled. */
  cancel(jobId: string): Promise<CancelResult>;
  /** Whether the worker actually came up (jobs don't process until it does). */
  readonly workerStarted: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  routers: {
    events: Router;
    jobs: Router;
    notifications: Router;
  };
}

export function createJobs<M = Record<string, unknown>>(opts: CreateJobsOptions<M>): Jobs {
  const jobStore = new JobStore(opts.db);
  const notifications = new NotificationStore(opts.db);
  const hub = opts.hub ?? new EventHub(opts.connectionString);
  const orgIdOf = opts.orgIdOf ?? orgIdFromUser;
  const startWorker = opts.startWorker ?? defaultStartWorker;

  const publish = (org: string, event: ServerEvent): Promise<void> =>
    publishEvent(opts.db, org, event);
  const rt: JobRuntime<M> = {
    db: opts.db,
    jobStore,
    notifications,
    publish,
    onException: opts.onException,
  };

  let runner: Runner | null = null;

  const requireRunner = (): Runner => {
    if (!runner) throw new Error('the background job worker is not running');
    return runner;
  };

  const addJob = async (
    task: string,
    payload: Record<string, unknown>,
    jobKey: string,
  ): Promise<void> => {
    await requireRunner().addJob(task, payload, { jobKey, maxAttempts: 1 });
  };

  const singleFlightEnqueue = async (
    task: string,
    org: string,
    key: string,
    payload: Record<string, unknown>,
  ): Promise<string | null> => {
    requireRunner();
    let job;
    try {
      job = await jobStore.create({ org, type: task, key, payload });
    } catch (err) {
      if (err instanceof ActiveJobExistsError) return null;
      throw err;
    }
    try {
      // The row id is stamped LAST: a caller that forwards another job's payload
      // (a chain built from the settling job's own) must never address this
      // job at that row — the task would find it settled and skip the body.
      await addJob(task, { ...payload, jobId: job.id }, key);
    } catch (err) {
      // No graphile job exists to run (or settle) the row we just created — a
      // 'queued' row would hold the single-flight key until the next restart's
      // boot recovery, turning every request for this key until then into a
      // bogus "already running" null. Mark it terminal, then rethrow.
      await jobStore.markFailed(job.id, (err as Error).message).catch(() => undefined);
      throw err;
    }
    return job.id;
  };

  const cancel = async (jobId: string): Promise<CancelResult> => {
    const job = await jobStore.get(jobId);
    if (!job || !isActiveJob(job.status)) return 'absent';
    if (isJobRunningLocally(jobId)) {
      // Abort it and wait: the harness settles the row `cancelled` as the body
      // unwinds, so the job's own teardown (clone disposal, children) still runs.
      await cancelLocalJob(jobId);
      // A body that ignored its signal may have settled some other way; this is
      // a no-op then, and the safety net when it left the row active.
      await jobStore.markCancelled(jobId);
      return 'cancelled';
    }
    // Claimed by another replica: its row is not ours to settle — the work is
    // still running over there, and freeing the key would invite a duplicate.
    if (job.status === 'running') return 'not-here';
    // Still queued: cancelling the row is enough — whichever worker picks the
    // graphile job up finds it unclaimable and skips the body.
    return (await jobStore.markCancelled(jobId)) ? 'cancelled' : 'absent';
  };

  return {
    jobStore,
    notifications,
    hub,
    addJob,
    singleFlightEnqueue,
    cancel,
    get workerStarted() {
      return runner !== null;
    },
    async start() {
      // Boot recovery: the in-process worker means a restart abandoned any
      // in-flight job. Reap them so the single-flight keys free and stale
      // "in progress" UI clears.
      const reaped = await jobStore.failOrphaned();
      if (reaped.length > 0) {
        log.info(`[jobs] reaped ${reaped.length} orphaned job(s) from a prior run`);
        await opts.onReaped?.(reaped);
      }
      await hub.start();
      runner = await startWorker({
        rt,
        connectionString: opts.connectionString,
        concurrency: opts.concurrency,
        tasks: opts.tasks,
      });
    },
    async stop() {
      const stopping = runner;
      runner = null;
      await stopping?.stop().catch(() => undefined);
      await hub.stop().catch(() => undefined);
    },
    routers: {
      events: createEventsRouter(hub, orgIdOf),
      jobs: createJobsRouter(jobStore, orgIdOf),
      notifications: createNotificationsRouter(notifications, orgIdOf),
    },
  };
}

export { JobStepTracker, type StepSnapshot, type StepEmit } from './steps.js';
export { EventHub, publishEvent, type EventBackplane } from './events.js';
export {
  executeJob,
  type JobContext,
  type JobDefinition,
  type JobNotification,
  type JobOutcome,
  type JobOutcomeStatus,
  type JobPayload,
  type JobRuntime,
  type StepDef,
} from './harness.js';
export {
  cancelLocalJob,
  isJobRunningLocally,
  registerJob,
  startWorker,
  stepBridge,
  type JobHelperSignals,
  type JobTask,
  type StartWorker,
  type StartWorkerOptions,
} from './worker.js';
export {
  createEventsRouter,
  createJobsRouter,
  createNotificationsRouter,
  orgIdFromUser,
  type OrgIdOf,
} from './routes.js';
export { createSemaphore, type Semaphore } from './semaphore.js';
export {
  drainCoalesced,
  enqueueOrPendCoalesced,
  type CoalesceEnqueueDeps,
  type CoalescePendingUpsert,
  type CoalesceRequest,
} from './pending-coalesce.js';
