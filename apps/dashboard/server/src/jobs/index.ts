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
 *
 * AND THE HEAVY JOBS RUN ONE AT A TIME PER WORKSPACE. Flow setup, generation
 * and the run each clone the repository, install and build it, map its
 * interfaces and spend the model's sessions; several of them side by side
 * starve the process that is also serving HTTP. So all three are enqueued into
 * ONE graphile queue per workspace ({@link heavyJobQueue}): a workspace's
 * second heavy job waits IN THE QUEUE as a `queued` row — visible as such on
 * the Agent page and in `/api/jobs` — and starts when the running one settles,
 * in enqueue order. Nothing waits in this process, so the gate survives a
 * restart and holds across replicas; `context.sync` and `context.scan` name no
 * queue and keep running beside a heavy job.
 *
 * AND A PUSH TO THE DEFAULT BRANCH RUNS THE MAIN CHAIN, COALESCED. The chain
 * is setup → generate → run, pinned to ONE commit: the pushed one, which the
 * repository row remembers (`defaultBranchSha`, written by the webhook before
 * the chain starts). At most one chain runs and one waits per repository: a
 * push that lands while any heavy job of the repository is active starts
 * nothing; when a chain ends — the run settles, or an earlier link stops
 * short — the mount compares the row's commit with the one the chain was
 * pinned to and starts one more chain if they differ. Three pushes during a
 * chain cost one follow-up, and a chain that fails at its own commit is not
 * started again: only a newer push starts one.
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
import type { PausedJob } from '@truecourse/data-store';
import type { RepositoryStore } from '@truecourse/shared';
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
  createRepoPullRequestCheckTask,
  pullRequestCheckJobKey,
  REPO_PR_CHECK_TASK,
  type PullRequestCheckJobRequest,
  type RepoPullRequestCheckTaskDeps,
} from './tasks/repo-pr-check.js';
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
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { getWorkspaceDecisions } from '@truecourse/core/commands/spec-in-process';
import { openConflicts } from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import { captureJobFinished, captureJobStarted, captureRunResumed } from '../observability/posthog.js';
import { rippleLinksChanged, type RippleStart } from './context-ripple.js';
import type { OnboardingJobRequest } from './tasks/onboarding.js';

/** What an enqueue did: it queued a job, or the repo is already working. */
export type EnqueueResult = { status: 'queued'; jobId: string } | { status: 'busy' };

/** The job surface the app mounts and the routes enqueue onto. */
export interface JobsMount extends Jobs {
  enqueueGuardSetup(request: GuardSetupJobRequest): Promise<EnqueueResult>;
  enqueueGuardGenerate(request: GuardGenerateJobRequest): Promise<EnqueueResult>;
  enqueueGuardRun(request: GuardRunJobRequest): Promise<EnqueueResult>;
  /**
   * A push to the default branch: run the main chain at its tip, unless a
   * heavy job of the repository is already active — then `busy`, and the
   * chain that is running follows up on its own when it ends.
   */
  startMainChain(request: MainChainRequest): Promise<EnqueueResult>;
  /**
   * One pull request's check, in the workspace's heavy lane behind any main
   * chain waiting there. One check per pull request is active: a second
   * request while one runs is `busy` (the host supersedes first).
   */
  enqueuePullRequestCheck(request: PullRequestCheckJobRequest): Promise<EnqueueResult>;
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
   * A repository's links changed, so its slice moved without the corpus
   * moving: start what the ripple would start for it — nothing while its setup
   * is in flight, Flow generation once set up, Flow setup before — under the
   * ripple's gates. Null when nothing was started.
   */
  startForLinks(request: LinksChangedRequest): Promise<RippleStart | null>;
  /**
   * Stop everything this repository has in flight, for a disconnect. `not-here`
   * means one of its jobs is running on another replica, which is not ours to
   * settle — the caller must refuse the disconnect.
   */
  cancelRepoJobs(repoFullName: string, orgId: string): Promise<'stopped' | 'not-here'>;
  /**
   * Carry a paused job on: the SAME row goes back to `queued` and the queue is
   * handed the payload it paused with — the enqueue request it was created
   * with, plus whatever pointer it settled on — under the key and the lane it
   * had. Answers that job's id (it keeps the one it has), or null when the row
   * was already carried on or its key is busy again.
   */
  resumePaused(job: PausedJob): Promise<string | null>;
}

/** The repository a push moved, as the webhook names it. */
export type MainChainRequest = Pick<OnboardingJobRequest, 'repoId' | 'repoFullName' | 'workspaceOrgId'>;

export interface LinksChangedRequest {
  workspaceOrgId: string;
  repoId: string;
  repoFullName: string;
  /** The links the repository now has. */
  sourceIds: string[];
}

export interface CreateServerJobsOptions {
  db: Db;
  connectionString: string;
  /**
   * The connected repositories: where the newest pushed commit is read from
   * when a chain ends. Without it (a test that pushes nothing) no chain ever
   * follows up.
   */
  repos?: RepositoryStore;
  /** Task-body seams (tests substitute the engines each job drives). */
  guardSetup?: Omit<RepoGuardSetupTaskDeps, 'chainGuardGenerate'>;
  guardGenerate?: Omit<RepoGuardGenerateTaskDeps, 'chainGuardRun'>;
  guardRun?: RepoGuardRunTaskDeps;
  /**
   * The pull request check's stores and GitHub client. Without them the task
   * is not registered: a server with no GitHub App has no pull requests.
   * `onStopped` settles a check whose job never reached its own settle — one
   * a disconnect stopped while it was still queued (`cancelled`), or one the
   * process died under (`error`), which boot reaps.
   */
  pullRequestCheck?: RepoPullRequestCheckTaskDeps & {
    onStopped?: (repoFullName: string, number: number, reason: 'cancelled' | 'error') => Promise<void>;
  };
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

  // The three heavy jobs all enqueue through here, which is what puts every one
  // of them in the workspace's single heavy queue.
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
      { queue: heavyJobQueue(request.workspaceOrgId), priority: MAIN_CHAIN_PRIORITY },
    );
    return jobId ? { status: 'queued', jobId } : { status: 'busy' };
  };

  const enqueuePullRequestCheck = async (request: PullRequestCheckJobRequest): Promise<EnqueueResult> => {
    const jobId = await jobs.singleFlightEnqueue(
      REPO_PR_CHECK_TASK,
      request.workspaceOrgId,
      pullRequestCheckJobKey(request.repoFullName, request.number),
      { ...request },
      { queue: heavyJobQueue(request.workspaceOrgId), priority: PULL_REQUEST_CHECK_PRIORITY },
    );
    return jobId ? { status: 'queued', jobId } : { status: 'busy' };
  };

  const enqueueGuardSetup = (request: GuardSetupJobRequest): Promise<EnqueueResult> =>
    enqueue(REPO_GUARD_SETUP_TASK, 'guard-setup', request, { ...request });

  const enqueueGuardGenerate = (request: GuardGenerateJobRequest): Promise<EnqueueResult> =>
    enqueue(REPO_GUARD_GENERATE_TASK, 'guard-generate', request, { ...request });

  const enqueueGuardRun = (request: GuardRunJobRequest): Promise<EnqueueResult> =>
    enqueue(REPO_GUARD_RUN_TASK, 'guard-run', request, { ...request });

  /** Is any link of this repository's main chain queued or running? */
  const repoHasHeavyJob = async (request: MainChainRequest): Promise<boolean> => {
    for (const task of MAIN_CHAIN_TASKS) {
      if (await jobs.jobStore.getActiveByKey(request.workspaceOrgId, jobKey(task, request.repoFullName))) {
        return true;
      }
    }
    return false;
  };

  const startMainChain = async (request: MainChainRequest): Promise<EnqueueResult> => {
    if (await repoHasHeavyJob(request)) return { status: 'busy' };
    // Pinned to the pushed commit the row remembers, so what the chain works
    // on and what it is compared against when it ends are the same commit by
    // construction. A fresh request from the three facts alone: never a
    // chain's own payload, whose row id must not carry into the new chain.
    const { repoId, repoFullName, workspaceOrgId } = request;
    const pushed = (await opts.repos?.getRepo(repoFullName))?.defaultBranchSha ?? null;
    return enqueueGuardSetup({
      repoId,
      repoFullName,
      workspaceOrgId,
      source: 'push',
      ...(pushed ? { commitSha: pushed } : {}),
    });
  };

  /**
   * A chain ended at `commitSha`, its commit (null when it never got to
   * clone). If the default branch has moved past it since — the webhook
   * recorded a newer push — and nothing of the repository is active, run the
   * chain once more, at the newer commit. A chain that failed at its own
   * commit starts nothing, and one with no commit to compare starts nothing
   * either.
   */
  const onChainEnd = async (request: OnboardingJobRequest, commitSha: string | null): Promise<void> => {
    const target = commitSha;
    if (!opts.repos || !target) return;
    try {
      const link = await opts.repos.getRepo(request.repoFullName);
      if (!link?.enabled || !link.defaultBranchSha || link.defaultBranchSha === target) return;
      const outcome = await startMainChain(request);
      log.info(
        `[jobs] ${request.repoFullName} moved to ${link.defaultBranchSha.slice(0, 8)} while its chain ran at ${target.slice(0, 8)} — follow-up chain ${outcome.status}`,
      );
    } catch (err) {
      log.warn(`[jobs] could not follow up on ${request.repoFullName}'s chain: ${(err as Error).message}`);
    }
  };

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

  const startForLinks = async (request: LinksChangedRequest): Promise<RippleStart | null> => {
    const { workspaceOrgId, repoId, repoFullName, sourceIds } = request;
    const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId }, 'corpus');
    const conflicts = corpus
      ? openConflicts(corpus, await getWorkspaceDecisions(workspaceOrgId)).length
      : 0;
    return rippleLinksChanged(rippleDeps(workspaceOrgId), {
      corpus,
      openConflicts: conflicts,
      repo: { repoId, repoFullName, sourceIds },
    });
  };

  const tasks: readonly JobTask[] = [
    createRepoGuardSetupTask({
      ...opts.guardSetup,
      onChainEnd,
      chainGuardGenerate: async (request) => {
        const outcome = await enqueueGuardGenerate(request);
        if (outcome.status === 'busy') {
          log.info(`[jobs] scenario generation for ${request.repoFullName} is already in flight`);
        }
      },
    }),
    createRepoGuardGenerateTask({
      ...opts.guardGenerate,
      onChainEnd,
      chainGuardRun: async (request) => {
        const outcome = await enqueueGuardRun(request);
        if (outcome.status === 'busy') {
          log.info(`[jobs] the baseline run for ${request.repoFullName} is already in flight`);
        }
      },
    }),
    createRepoGuardRunTask({ ...opts.guardRun, onChainEnd }),
    ...(opts.pullRequestCheck ? [createRepoPullRequestCheckTask(opts.pullRequestCheck)] : []),
    createContextSyncTask({
      ...opts.contextSync,
      // A repository's FIRST sync is the rest of its onboarding: Flow setup
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
          log.info(`[jobs] flow setup for ${repo.repoFullName} is already in flight`);
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
    // A check whose job died with the process: its row and GitHub's check
    // would otherwise say "running" for ever.
    onReaped: async (reaped) => {
      for (const job of reaped) {
        if (job.type !== REPO_PR_CHECK_TASK || !opts.pullRequestCheck?.onStopped) continue;
        const { repoFullName, number } = job.payload as Pick<PullRequestCheckJobRequest, 'repoFullName' | 'number'>;
        await opts.pullRequestCheck.onStopped(repoFullName, number, 'error');
      }
    },
    // The start and the finish of every job someone asked for, from the two
    // places every job passes through: its claim and its settle.
    onStarted: captureJobStarted,
    onSettled: captureJobFinished,
    ...(opts.startWorker ? { startWorker: opts.startWorker } : {}),
    ...(opts.hub ? { hub: opts.hub } : {}),
  });

  // Every heavy job of the repository goes, RUNNING OR QUEUED: the workspace's
  // heavy lane means a disconnected repository can easily have one waiting its
  // turn, and `getActiveByKey` covers both states (`jobs.cancel` settles a
  // queued row outright — the worker that later claims its graphile job finds
  // the row unclaimable and skips the body, freeing the lane immediately).
  // Its pull request checks go with it, found by their keys' prefix.
  const cancelRepoJobs = async (
    repoFullName: string,
    orgId: string,
  ): Promise<'stopped' | 'not-here'> => {
    const active = [];
    for (const task of MAIN_CHAIN_TASKS) {
      const job = await jobs.jobStore.getActiveByKey(orgId, jobKey(task, repoFullName));
      if (job) active.push(job);
    }
    for (const job of active) {
      if ((await jobs.cancel(job.id)) === 'not-here') return 'not-here';
    }
    // Its checks: settled as cancelled, which stops their jobs too (a check
    // still queued would otherwise never be settled by anyone).
    const checkPrefix = pullRequestCheckJobKey(repoFullName, 0).slice(0, -1);
    for (const job of await jobs.jobStore.listActive(orgId, REPO_PR_CHECK_TASK)) {
      if (!job.key?.startsWith(checkPrefix)) continue;
      const number = Number(job.key.slice(checkPrefix.length));
      if (opts.pullRequestCheck?.onStopped) await opts.pullRequestCheck.onStopped(repoFullName, number, 'cancelled');
      if ((await jobs.cancel(job.id)) === 'not-here') return 'not-here';
    }
    return 'stopped';
  };

  /**
   * A paused job, carried on. The ROW itself goes back to `queued` and the
   * queue is handed the payload it paused with — its enqueue request plus the
   * resume pointer its body merged onto it — under the same key and, for a
   * heavy job, into the same workspace lane, so a resumed run queues behind
   * whatever is running rather than beside it.
   *
   * ONE row from beginning to end: a resume is the same job carrying on, so
   * there is never a second row with the same payload, and nothing is left
   * sitting at `paused` next to a running twin. Null when the row was already
   * carried on or its key is active again; it stays paused for the next try.
   */
  const resumePaused = async (job: PausedJob): Promise<string | null> => {
    const revived = await jobs.jobStore.markRequeued(job.id);
    if (!revived) return null;
    const key = job.key ?? `${job.type}:${job.id}`;
    try {
      await jobs.addJob(
        job.type,
        { ...(job.payload ?? {}), jobId: job.id },
        key,
        HEAVY_TASKS.includes(job.type)
          ? {
              queue: heavyJobQueue(job.workspaceOrgId),
              priority: job.type === REPO_PR_CHECK_TASK ? PULL_REQUEST_CHECK_PRIORITY : MAIN_CHAIN_PRIORITY,
            }
          : undefined,
      );
    } catch (err) {
      // No graphile job exists to run the row we just revived, and a `queued`
      // row holds the single-flight key until the next boot sweep. Put it back
      // where it was — paused, and offered again — then say why.
      await jobs.jobStore
        .markPaused(job.id, { reason: job.reason ?? 'credits' })
        .catch(() => undefined);
      throw err;
    }
    captureRunResumed(job.workspaceOrgId, job.type, job.id);
    return job.id;
  };

  return Object.assign(jobs, {
    enqueueGuardSetup,
    enqueueGuardGenerate,
    enqueueGuardRun,
    startMainChain,
    enqueuePullRequestCheck,
    enqueueContextSync,
    enqueueContextScan,
    startForLinks,
    cancelRepoJobs,
    resumePaused,
  });
}

/** The four that share a workspace's one lane. */
/** The three links of a repository's main chain, one key each. */
const MAIN_CHAIN_TASKS: readonly string[] = [REPO_GUARD_SETUP_TASK, REPO_GUARD_GENERATE_TASK, REPO_GUARD_RUN_TASK];
/** Every job that runs in the workspace's heavy lane. */
const HEAVY_TASKS: readonly string[] = [...MAIN_CHAIN_TASKS, REPO_PR_CHECK_TASK];

/**
 * Within the lane, the main chain goes before a pull request's check waiting
 * beside it: the default branch's state is what every check compares against.
 * graphile claims the lower number first, with no aging — a workspace whose
 * repositories push without pause keeps its checks waiting.
 */
const MAIN_CHAIN_PRIORITY = 0;
const PULL_REQUEST_CHECK_PRIORITY = 10;

/** The session-run commands the onboarding jobs run — what `repoIsWorking` reads.
 *  A run spends no sessions, so `guard-run` never has a record to find. */
type RepoCommand = 'guard-setup' | 'guard-generate' | 'guard-run';

/** One active job per (workspace, repo, task) — the queue's single-flight key. */
const jobKey = (task: string, repoFullName: string): string => `${task}:${repoFullName}`;

/**
 * The workspace's heavy lane: setup, generation and the run of EVERY repository
 * of a workspace share one graphile queue, so graphile runs them one at a time,
 * in enqueue order. Per workspace rather than per repository — the cost being
 * rationed is this process's, and a workspace is who pays for it.
 */
const heavyJobQueue = (org: string): string => `heavy:${org}`;

/**
 * Is this repository already running this command — in ANY workspace? The
 * session-run store is the one place a run of a repo is visible whoever started
 * it (it sweeps dead-pid runs as it reads, so `running` means a live process).
 */
async function repoIsWorking(repoFullName: string, command: RepoCommand): Promise<boolean> {
  if (command === 'guard-run') return false;
  return (await listStoredSessionRuns(repoFullName, command)).some((run) => run.status === 'running');
}
