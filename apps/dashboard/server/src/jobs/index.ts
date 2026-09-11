/**
 * The dashboard server's background job runner.
 *
 * Long-running work (a document scan, a guard setup) runs here rather than
 * inside the request that asked for it: the route enqueues and answers, the
 * queue runs the job, and the client follows it over the SSE stream and the
 * repo's socket room. `createServerJobs` builds the runner and `JobsMount` is
 * what `createApp` needs to expose it.
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
import { listStoredSessionRuns } from '@truecourse/core/lib/sessions-store';
import { log } from '@truecourse/core/lib/logger';
import type { Db } from '@truecourse/db';
import {
  createRepoGuardSetupTask,
  REPO_GUARD_SETUP_TASK,
  type GuardSetupJobRequest,
  type RepoGuardSetupTaskDeps,
} from './tasks/repo-guard-setup.js';
import {
  createRepoGuardGenerateTask,
  REPO_GUARD_GENERATE_TASK,
  type GuardGenerateJobRequest,
  type RepoGuardGenerateTaskDeps,
} from './tasks/repo-guard-generate.js';
import {
  createRepoGuardRunTask,
  REPO_GUARD_RUN_TASK,
  type GuardRunJobRequest,
  type RepoGuardRunTaskDeps,
} from './tasks/repo-guard-run.js';
import {
  createContextSyncTask,
  contextSyncJobKey,
  CONTEXT_SYNC_TASK,
  type ContextSyncJobRequest,
  type ContextSyncJobResult,
  type ContextSyncTaskDeps,
} from './tasks/context-sync.js';
import {
  createContextScanTask,
  contextScanJobKey,
  CONTEXT_SCAN_TASK,
  type ContextScanJobRequest,
  type ContextScanTaskDeps,
} from './tasks/context-scan.js';
import {
  repositoryOfSource,
  workspaceRepositories,
} from '../services/context-scan.service.js';
import { loadGuardSetupBundle } from '@truecourse/core/lib/guard-store';
import type { OnboardingJobRequest } from './tasks/onboarding.js';

/** What an enqueue did: it queued a job, or the repo is already working. */
export type EnqueueResult = { status: 'queued'; jobId: string } | { status: 'busy' };

/** The job surface the app mounts and the routes enqueue onto. */
export interface JobsMount extends Jobs {
  enqueueGuardSetup(request: GuardSetupJobRequest): Promise<EnqueueResult>;
  enqueueGuardGenerate(request: GuardGenerateJobRequest): Promise<EnqueueResult>;
  enqueueGuardRun(request: GuardRunJobRequest): Promise<EnqueueResult>;
  /**
   * Refresh ONE workspace context source. Keyed by the source, not the repo:
   * a source belongs to the workspace and several repositories may read it.
   */
  enqueueContextSync(request: ContextSyncJobRequest): Promise<EnqueueResult>;
  /**
   * The workspace Document scan. One per workspace: a second request while one
   * runs is `busy`, and the scan itself queues the single follow-up run when
   * the context moved under it (see `tasks/context-scan.ts`).
   */
  enqueueContextScan(request: ContextScanJobRequest): Promise<EnqueueResult>;
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
  guardSetup?: Omit<RepoGuardSetupTaskDeps, 'chainGuardGenerate'>;
  guardGenerate?: Omit<RepoGuardGenerateTaskDeps, 'chainGuardRun'>;
  guardRun?: RepoGuardRunTaskDeps;
  contextSync?: ContextSyncTaskDeps;
  contextScan?: Omit<ContextScanTaskDeps, 'ripple' | 'rescan'>;
  /** How the worker runner is started. Substituted in tests. */
  startWorker?: StartWorker<Record<string, unknown>>;
  /** The live backplane. Defaults to the queue's Postgres LISTEN/NOTIFY hub. */
  hub?: EventBackplane;
}

export function createServerJobs(opts: CreateServerJobsOptions): JobsMount {
  // Setup chains into generate and generate into the baseline run, and every
  // enqueue lives on the mount the runner is part of — so the task list closes
  // over a runner that exists a line later.
  let jobs!: Jobs;

  const enqueue = async (
    task: string,
    command: RepoCommand,
    request: OnboardingJobRequest,
    payload: Record<string, unknown>,
  ): Promise<EnqueueResult> => {
    if (await repoIsWorking(request.repoFullName, command)) return { status: 'busy' };
    const jobId = await jobs.singleFlightEnqueue(
      task,
      request.workspaceOrgId,
      jobKey(task, request.repoFullName),
      payload,
    );
    return jobId ? { status: 'queued', jobId } : { status: 'busy' };
  };

  const enqueueGuardSetup = (request: GuardSetupJobRequest): Promise<EnqueueResult> =>
    enqueue(REPO_GUARD_SETUP_TASK, 'guard-setup', request, { ...request });

  const enqueueGuardGenerate = (request: GuardGenerateJobRequest): Promise<EnqueueResult> =>
    enqueue(REPO_GUARD_GENERATE_TASK, 'guard-generate', request, { ...request });

  const enqueueGuardRun = (request: GuardRunJobRequest): Promise<EnqueueResult> =>
    enqueue(REPO_GUARD_RUN_TASK, 'guard-run', request, { ...request });

  // A context source is not a repository: nothing about it is visible in the
  // session-run store, so the queue's single-flight key is the whole guard.
  const enqueueContextSync = async (request: ContextSyncJobRequest): Promise<EnqueueResult> => {
    const jobId = await jobs.singleFlightEnqueue(
      CONTEXT_SYNC_TASK,
      request.workspaceOrgId,
      contextSyncJobKey(request.sourceId),
      { ...request },
    );
    return jobId ? { status: 'queued', jobId } : { status: 'busy' };
  };

  // One scan per workspace — the key is the task itself, since the row is
  // already scoped to the org. A loser is `busy`, never a queued duplicate: the
  // scan re-reads the workspace's staleness stamp when it settles and queues
  // the single follow-up run itself.
  const enqueueContextScan = async (request: ContextScanJobRequest): Promise<EnqueueResult> => {
    const jobId = await jobs.singleFlightEnqueue(
      CONTEXT_SCAN_TASK,
      request.workspaceOrgId,
      contextScanJobKey(),
      { ...request },
    );
    return jobId ? { status: 'queued', jobId } : { status: 'busy' };
  };

  /**
   * The ripple's collaborators: who reads what, whether a repository has been
   * set up, and the two enqueues that start it. Built here because only the
   * mount holds them.
   */
  const rippleDeps = (workspaceOrgId: string) => ({
    workspaceOrgId,
    listRepos: () => workspaceRepositories(workspaceOrgId),
    hasSetup: async (repoFullName: string) =>
      (await loadGuardSetupBundle(repoFullName)) !== null,
    isSettingUp: async (repoFullName: string) =>
      (await jobs.jobStore.getActiveByKey(
        workspaceOrgId,
        jobKey(REPO_GUARD_SETUP_TASK, repoFullName),
      )) !== null,
    startSetup: async (repo: { repoId: string; repoFullName: string }) =>
      (
        await enqueueGuardSetup({
          repoId: repo.repoId,
          repoFullName: repo.repoFullName,
          workspaceOrgId,
          source: 'chain',
        })
      ).status === 'queued',
    startGenerate: async (repo: { repoId: string; repoFullName: string }) =>
      (
        await enqueueGuardGenerate({
          repoId: repo.repoId,
          repoFullName: repo.repoFullName,
          workspaceOrgId,
          source: 'chain',
        })
      ).status === 'queued',
  });

  const tasks: readonly JobTask[] = [
    createRepoGuardSetupTask({
      ...opts.guardSetup,
      chainGuardGenerate: async (request) => {
        const outcome = await enqueueGuardGenerate(request);
        if (outcome.status === 'busy') {
          log.info(`[jobs] scenario generation for ${request.repoFullName} is already in flight`);
        }
      },
    }),
    createRepoGuardGenerateTask({
      ...opts.guardGenerate,
      chainGuardRun: async (request) => {
        const outcome = await enqueueGuardRun(request);
        if (outcome.status === 'busy') {
          log.info(`[jobs] the baseline run for ${request.repoFullName} is already in flight`);
        }
      },
    }),
    createRepoGuardRunTask(opts.guardRun),
    createContextSyncTask({
      ...opts.contextSync,
      // A repository's FIRST sync is the rest of its onboarding: Test setup
      // needs no documents, so it starts whatever the sync reconciled — a
      // repository with no markdown at all still gets set up. Started here, the
      // scan's ripple finds it working rather than racing it.
      chainSetup: async (request) => {
        if (request.source !== 'add') return;
        const repo = await repositoryOfSource(request.workspaceOrgId, request.sourceId);
        if (!repo) return;
        // A repository that has been set up before is not onboarding: what it
        // needs from a sync is the scan, which the chain below starts.
        if ((await loadGuardSetupBundle(repo.repoFullName)) !== null) return;
        const outcome = await enqueueGuardSetup({
          ...repo,
          workspaceOrgId: request.workspaceOrgId,
          source: 'chain',
        });
        if (outcome.status === 'busy') {
          log.info(`[jobs] test setup for ${repo.repoFullName} is already in flight`);
        }
      },
      // A sync that reconciled nothing changed no document, so there is nothing
      // for the scan to re-read; one that did is what makes the corpus stale.
      chainScan: async (request, result) => {
        if (result.added + result.changed + result.removed === 0) return;
        const outcome = await enqueueContextScan({
          workspaceOrgId: request.workspaceOrgId,
          source: 'sync',
        });
        if (outcome.status === 'busy') {
          log.info(
            `[jobs] a document scan is already running for ${request.workspaceOrgId} — it will re-read the sync`,
          );
        }
      },
    }),
    createContextScanTask({
      ...opts.contextScan,
      ripple: rippleDeps,
      rescan: async (request) => {
        await enqueueContextScan(request);
      },
    }),
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
    for (const task of [
      REPO_GUARD_SETUP_TASK,
      REPO_GUARD_GENERATE_TASK,
      REPO_GUARD_RUN_TASK,
    ]) {
      const active = await jobs.jobStore.getActiveByKey(orgId, jobKey(task, repoFullName));
      if (!active) continue;
      if ((await jobs.cancel(active.id)) === 'not-here') return 'not-here';
    }
    return 'stopped';
  };

  return Object.assign(jobs, {
    enqueueGuardSetup,
    enqueueGuardGenerate,
    enqueueGuardRun,
    enqueueContextSync,
    enqueueContextScan,
    cancelRepoJobs,
  });
}

/** The session-run commands the onboarding jobs run — what `repoIsWorking` reads.
 *  A run spends no sessions, so `guard-run` never has a record to find. */
type RepoCommand = 'guard-setup' | 'guard-generate' | 'guard-run';

/** One active job per (workspace, repo, task) — the queue's single-flight key. */
const jobKey = (task: string, repoFullName: string): string => `${task}:${repoFullName}`;

/**
 * Is this repository already running this command — in ANY workspace? The
 * session-run store is the one place a run of a repo is visible whoever started
 * it (it sweeps dead-pid runs as it reads, so `running` means a live process).
 */
async function repoIsWorking(repoFullName: string, command: RepoCommand): Promise<boolean> {
  if (command === 'guard-run') return false;
  return (await listStoredSessionRuns(repoFullName, command)).some((run) => run.status === 'running');
}
