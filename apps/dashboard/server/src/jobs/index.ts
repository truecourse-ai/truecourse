/**
 * The dashboard server's background job runner.
 *
 * Long-running work (a spec scan, a guard setup) runs here rather than inside
 * the request that asked for it: the route enqueues and answers, the queue runs
 * the job, and the client follows it over the SSE stream and the repo's socket
 * room. `createServerJobs` builds the runner and `JobsMount` is what
 * `createApp` needs to expose it.
 *
 * ENQUEUEING IS GUARDED TWICE. The queue's single-flight key stops a second
 * job for the same repo in the same workspace; a store-wide look at the repo's
 * session runs stops one in ANOTHER workspace, since two workspaces can connect
 * the same `owner/repo` and the durable stores it writes have no workspace
 * column. Either way the answer is `busy`, and nothing is enqueued.
 */

import {
  createJobs,
  type EventBackplane,
  type Jobs,
  type JobTask,
  type StartWorker,
} from '@truecourse/jobs';
import { listSessionRuns } from '@truecourse/core/lib/sessions-store';
import { log } from '@truecourse/core/lib/logger';
import type { Db } from '@truecourse/db';
import {
  createRepoScanTask,
  REPO_SCAN_TASK,
  type RepoScanTaskDeps,
} from './tasks/repo-scan.js';
import {
  createRepoGuardSetupTask,
  REPO_GUARD_SETUP_TASK,
  type GuardSetupJobRequest,
  type RepoGuardSetupTaskDeps,
} from './tasks/repo-guard-setup.js';
import type { OnboardingJobRequest } from './tasks/onboarding.js';

/** What an enqueue did: it queued a job, or the repo is already working. */
export type EnqueueResult = { status: 'queued'; jobId: string } | { status: 'busy' };

/** The job surface the app mounts and the routes enqueue onto. */
export interface JobsMount extends Jobs {
  enqueueScan(request: OnboardingJobRequest): Promise<EnqueueResult>;
  enqueueGuardSetup(request: GuardSetupJobRequest): Promise<EnqueueResult>;
  /**
   * Stop everything this repository has in flight, for a disconnect. `not-here`
   * means one of its jobs is running on another replica, which is not ours to
   * settle — the caller must refuse the disconnect.
   */
  cancelRepoJobs(repoFullName: string, orgId: string): Promise<'stopped' | 'not-here'>;
}

export interface CreateServerJobsOptions {
  db: Db;
  connectionString: string;
  /** Task-body seams (tests substitute the engines each job drives). */
  scan?: Omit<RepoScanTaskDeps, 'chainGuardSetup'>;
  guardSetup?: RepoGuardSetupTaskDeps;
  /** How the worker runner is started. Substituted in tests. */
  startWorker?: StartWorker<Record<string, unknown>>;
  /** The live backplane. Defaults to the queue's Postgres LISTEN/NOTIFY hub. */
  hub?: EventBackplane;
}

export function createServerJobs(opts: CreateServerJobsOptions): JobsMount {
  // The scan chains into setup, and both enqueues live on the mount the runner
  // is part of — so the task list closes over a runner that exists a line later.
  let jobs!: Jobs;

  const enqueue = async (
    task: string,
    command: 'spec-scan' | 'guard-setup',
    request: OnboardingJobRequest,
    payload: Record<string, unknown>,
  ): Promise<EnqueueResult> => {
    if (repoIsWorking(request.repoFullName, command)) return { status: 'busy' };
    const jobId = await jobs.singleFlightEnqueue(
      task,
      request.workspaceOrgId,
      jobKey(task, request.repoFullName),
      payload,
    );
    return jobId ? { status: 'queued', jobId } : { status: 'busy' };
  };

  const enqueueScan = (request: OnboardingJobRequest): Promise<EnqueueResult> =>
    enqueue(REPO_SCAN_TASK, 'spec-scan', request, { ...request });

  const enqueueGuardSetup = (request: GuardSetupJobRequest): Promise<EnqueueResult> =>
    enqueue(REPO_GUARD_SETUP_TASK, 'guard-setup', request, { ...request });

  const tasks: readonly JobTask[] = [
    createRepoScanTask({
      ...opts.scan,
      chainGuardSetup: async (request) => {
        const outcome = await enqueueGuardSetup(request);
        if (outcome.status === 'busy') {
          log.info(`[jobs] guard setup for ${request.repoFullName} is already in flight`);
        }
      },
    }),
    createRepoGuardSetupTask(opts.guardSetup),
  ];

  jobs = createJobs({
    db: opts.db,
    connectionString: opts.connectionString,
    tasks,
    ...(opts.startWorker ? { startWorker: opts.startWorker } : {}),
    ...(opts.hub ? { hub: opts.hub } : {}),
  });

  const cancelRepoJobs = async (
    repoFullName: string,
    orgId: string,
  ): Promise<'stopped' | 'not-here'> => {
    for (const task of [REPO_SCAN_TASK, REPO_GUARD_SETUP_TASK]) {
      const active = await jobs.jobStore.getActiveByKey(orgId, jobKey(task, repoFullName));
      if (!active) continue;
      if ((await jobs.cancel(active.id)) === 'not-here') return 'not-here';
    }
    return 'stopped';
  };

  return Object.assign(jobs, { enqueueScan, enqueueGuardSetup, cancelRepoJobs });
}

/** One active job per (workspace, repo, task) — the queue's single-flight key. */
const jobKey = (task: string, repoFullName: string): string => `${task}:${repoFullName}`;

/**
 * Is this repository already running this command — in ANY workspace? The
 * session-run store is the one place a run of a repo is visible whoever started
 * it (it sweeps dead-pid runs as it reads, so `running` means a live process).
 */
function repoIsWorking(repoFullName: string, command: 'spec-scan' | 'guard-setup'): boolean {
  try {
    return listSessionRuns(repoFullName, command).some((run) => run.status === 'running');
  } catch {
    return false; // no store yet — nothing is running
  }
}
