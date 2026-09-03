/**
 * The in-process graphile-worker runner: it turns {@link JobDefinition}s into
 * graphile tasks and polls/LISTENs for work.
 *
 * Each task wraps one job in the ambient trace context (org / job / repo) LLM
 * calls are tagged with, hands it a cancellable signal, and runs it through the
 * shared {@link executeJob} envelope. Jobs are enqueued with `maxAttempts: 1`
 * (see index.ts): a failure is terminal and surfaced to the user, who can
 * re-run. So a thrown body is a permanent fail, never a silent retry that would
 * double-run and fight the single-flight key.
 *
 * The registry below is what makes a cancel actually STOP work: graphile's own
 * `helpers.abortSignal` only fires on worker shutdown, so each running job also
 * gets a local AbortController that {@link cancelLocalJob} trips, then waits on
 * the job's settle promise so the caller knows the work is really over.
 */

import { run, type Runner, type TaskList } from 'graphile-worker';
import { runWithTrace, type TraceContext } from '@truecourse/llm-api';
import { StepTracker, type AnalysisProgressPayload } from '@truecourse/core/progress';
import { log } from '@truecourse/core/lib/logger';
import type { JobStepTracker } from './steps.js';
import { executeJob, type JobDefinition, type JobPayload, type JobRuntime } from './harness.js';

/**
 * One job type the worker can run: its definition, or — when the body must read
 * seams that may be installed after the worker starts — a factory resolved per
 * invocation, which then carries the graphile task name itself.
 */
export type JobTask<M = Record<string, unknown>> =
  | JobDefinition<JobPayload, M>
  | { type: string; define(payload: JobPayload): JobDefinition<JobPayload, M> };

/** The only per-job helper the runner reads from graphile. */
export interface JobHelperSignals {
  abortSignal?: AbortSignal;
}

/** A job running in THIS process: how to stop it, and when it is really over. */
interface LocalRun {
  controller: AbortController;
  settled: Promise<void>;
}

const localRuns = new Map<string, LocalRun>();

function jobTrace(
  org: string,
  jobId: string,
  repo: { repoFullName?: string | null; commitSha?: string | null } = {},
): TraceContext {
  return {
    org,
    traceId: jobId,
    jobId,
    repoFullName: repo.repoFullName ?? null,
    commitSha: repo.commitSha ?? null,
    parentId: null,
  };
}

/**
 * Wrap a job definition as a graphile task. The payload arrives as JSON, so the
 * cast to `P` is the one unavoidable boundary assertion — the enqueue side owns
 * the shape.
 */
export function registerJob<M>(
  rt: JobRuntime<M>,
  task: JobTask<M>,
): (payload: unknown, helpers: JobHelperSignals) => Promise<void> {
  return (rawPayload, helpers) => {
    const payload = rawPayload as JobPayload;
    const def = 'define' in task ? task.define(payload) : task;
    const trace = jobTrace(def.org(payload), payload.jobId, def.traceMeta?.(payload));

    // Merge the two ways a job can be stopped: an explicit cancel (the local
    // controller) and graphile's shutdown signal.
    const controller = new AbortController();
    const shutdown = helpers.abortSignal;
    if (shutdown) {
      if (shutdown.aborted) controller.abort();
      else shutdown.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const running = runWithTrace(trace, () =>
      executeJob(rt, def, payload, { signal: controller.signal }),
    );
    // Registered synchronously (no await between here and the body starting), so
    // a cancel can never miss a job that is already in flight.
    const settled = running.then(
      () => undefined,
      () => undefined,
    );
    localRuns.set(payload.jobId, { controller, settled });
    void settled.then(() => {
      if (localRuns.get(payload.jobId)?.controller === controller) localRuns.delete(payload.jobId);
    });
    return running;
  };
}

/**
 * Stop a job running in THIS process and wait for it to unwind. Returns false
 * when the job isn't running here (another replica has it, or it never started)
 * — the caller decides what that means. The wait is bounded: a body that
 * ignores its signal must not hang the request that asked for the cancel.
 */
export async function cancelLocalJob(jobId: string, timeoutMs = 30_000): Promise<boolean> {
  const entry = localRuns.get(jobId);
  if (!entry) return false;
  entry.controller.abort();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([entry.settled, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return true;
}

/** Whether a job is running in this process (a cancel would reach it). */
export function isJobRunningLocally(jobId: string): boolean {
  return localRuns.has(jobId);
}

/**
 * Bridge a core in-process StepTracker onto one job step: each inner-phase
 * transition is forwarded as the job step's inline detail, so the popup shows
 * the same numbered sub-phases the in-process popup does. `stepDefs` is the
 * inner phase set to mirror. Returns a StepTracker to hand to the callee.
 */
export function stepBridge(
  tracker: JobStepTracker,
  stepKey: string,
  stepDefs: ReadonlyArray<{ key: string; label: string }>,
): StepTracker {
  return new StepTracker((p: AnalysisProgressPayload) => {
    const text = p.detail ? `${p.step} · ${p.detail}` : p.step;
    void tracker.detail(stepKey, text);
  }, [...stepDefs]);
}

export interface StartWorkerOptions<M> {
  rt: JobRuntime<M>;
  connectionString: string;
  tasks: readonly JobTask<M>[];
  concurrency?: number;
}

/** The seam `createJobs` starts its runner through (tests substitute a fake). */
export type StartWorker<M> = (opts: StartWorkerOptions<M>) => Promise<Runner>;

export async function startWorker<M>(opts: StartWorkerOptions<M>): Promise<Runner> {
  const taskList: TaskList = {};
  for (const task of opts.tasks) taskList[task.type] = registerJob(opts.rt, task);

  const runner = await run({
    connectionString: opts.connectionString,
    concurrency: opts.concurrency ?? 2,
    // The host owns SIGTERM/SIGINT: it stops the runner as part of its own
    // shutdown, after the rest of the server has been told to wind down.
    noHandleSignals: true,
    taskList,
  });
  log.info('[jobs] worker runner started');
  return runner;
}
