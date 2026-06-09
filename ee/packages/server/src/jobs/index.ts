/**
 * Background jobs + notifications wiring (enterprise, protected by the auth gate).
 *
 * `registerJobs` reaps orphaned jobs from a prior run, starts the LISTEN/NOTIFY
 * event hub + the in-process graphile-worker runner, and mounts three routers:
 *   - GET  /api/ee/events            — the per-user SSE stream
 *   - GET  /api/ee/jobs[?active=1]   — job status (seeds the UI's "Syncing" state)
 *   - GET/POST /api/ee/notifications — the durable feed + read-state
 *
 * It returns a `JobsApi` (the shared `JobStore` + an `enqueueSync`) that the
 * Knowledge router uses so `/sync` can create + enqueue a job instead of running
 * the work inline.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthUser, EeServerRegistry } from '@truecourse/shared';
import type { EeDb } from '@truecourse/ee-db';
import { JobStore, NotificationStore, ActiveJobExistsError } from '@truecourse/ee-data-store';
import { log } from '@truecourse/core/lib/logger';
import { setBackgroundTaskRunner } from '@truecourse/core/lib/background-tasks';
import type { Runner } from 'graphile-worker';
import { selectGateStore } from '@truecourse/ee-github-app';
import { EventHub } from './events.js';
import { startWorker } from './worker.js';
import { reverifyWorkspaceRepos } from './reverify.js';
import {
  KNOWLEDGE_SYNC_TASK,
  REPO_BASELINE_TASK,
  REPO_CONTRACTS_TASK,
  WORKSPACE_CONTRACTS_TASK,
  type SyncJobPayload,
  type BaselineEnqueueRequest,
} from './constants.js';

function orgIdOf(req: Request): string | null {
  return (req as Request & { eeUser?: AuthUser }).eeUser?.organizationId ?? null;
}

/** The job surface other modules enqueue onto: the shared store + the enqueues. */
export interface JobsApi {
  jobStore: JobStore;
  /** Enqueue a connector sync (maxAttempts:1 — a failure is terminal, see worker.ts). */
  enqueueSync(payload: SyncJobPayload, jobKey: string): Promise<void>;
  /**
   * Enqueue an initial/refresh repo scan (connect + default-branch push). Single-
   * flight per repo: returns the new job id, or null when a scan is already
   * running for that repo (so a redelivered push / re-connect is a no-op).
   */
  enqueueBaseline(req: BaselineEnqueueRequest): Promise<string | null>;
  /** Enqueue a workspace contract refresh after a Knowledge decision (debounced). */
  enqueueWorkspaceContracts(workspaceOrgId: string): Promise<void>;
}

function createEventsRouter(hub: EventHub): Router {
  const router = Router();
  router.get('/', (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) {
      res.status(401).json({ error: 'no workspace' });
      return;
    }
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy (nginx) buffering of the stream
    });
    res.flushHeaders?.();
    res.write(': connected\n\n');
    const unsubscribe = hub.subscribe(org, res);
    // Heartbeat keeps idle connections (and intermediary proxies) from closing.
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  return router;
}

function createJobsRouter(jobStore: JobStore): Router {
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const active = req.query.active === '1' || req.query.active === 'true';
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const jobs = active ? await jobStore.listActive(org, type) : await jobStore.listForOrg(org);
    res.json({ jobs });
  });
  router.get('/:id', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const job = await jobStore.get(String(req.params.id), org);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json(job);
  });
  return router;
}

const readSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().min(1)).min(1) }),
]);

function createNotificationsRouter(notifications: NotificationStore): Router {
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const [list, unreadCount] = await Promise.all([
      notifications.listForOrg(org),
      notifications.unreadCount(org),
    ]);
    res.json({ notifications: list, unreadCount });
  });
  router.get('/unread-count', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    res.json({ unreadCount: await notifications.unreadCount(org) });
  });
  router.post('/read', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = readSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    if ('all' in parsed.data) await notifications.markAllRead(org);
    else await notifications.markRead(org, parsed.data.ids);
    res.json({ unreadCount: await notifications.unreadCount(org) });
  });
  return router;
}

export interface RegisterJobsOptions {
  db: EeDb;
  connectionString: string;
  masterSecret: string;
}

export async function registerJobs(
  registry: EeServerRegistry,
  opts: RegisterJobsOptions,
): Promise<JobsApi> {
  const jobStore = new JobStore(opts.db);
  const notifications = new NotificationStore(opts.db);
  const hub = new EventHub(opts.connectionString);

  // Create (or reuse) the single-flight job row for a debounced contract refresh.
  // A burst of decisions coalesces onto ONE row (the partial-unique key), so the
  // progress popup shows once per repo/workspace, not per click.
  const ensureContractsJob = async (type: string, key: string, org: string): Promise<string> => {
    try {
      const job = await jobStore.create({ org, type, key });
      return job.id;
    } catch (err) {
      if (err instanceof ActiveJobExistsError) return err.existing.id;
      throw err;
    }
  };

  // Mount the routers first — pure wiring, no I/O — so the API surface is always
  // available even if the background services below fail to come up.
  registry.registerRouter('/api/ee/events', createEventsRouter(hub));
  registry.registerRouter('/api/ee/jobs', createJobsRouter(jobStore));
  registry.registerRouter('/api/ee/notifications', createNotificationsRouter(notifications));

  // Start the background services (need a live Postgres). A failure here must NOT
  // prevent the dashboard from booting — the HTTP server (auth, reads, capabilities)
  // still comes up; jobs simply don't process until a restart succeeds. enqueueSync
  // throws clearly if the worker never started.
  let runner: Runner | null = null;

  const gateStore = selectGateStore(opts.db);

  // Single-flight repo-baseline enqueue — shared by connect/push (returned below)
  // and the post-contracts chain. Closes over the `runner` assigned just below.
  const enqueueBaseline = async (req: BaselineEnqueueRequest): Promise<string | null> => {
    if (!runner) throw new Error('the background job worker is not running');
    const key = `${REPO_BASELINE_TASK}:${req.repoFullName}`;
    let job;
    try {
      job = await jobStore.create({ org: req.workspaceOrgId, type: REPO_BASELINE_TASK, key });
    } catch (err) {
      // A scan is already running for this repo — skip (idempotent connect/push/chain).
      if (err instanceof ActiveJobExistsError) return null;
      throw err;
    }
    await runner.addJob(REPO_BASELINE_TASK, { jobId: job.id, ...req }, { jobKey: key, maxAttempts: 1 });
    return job.id;
  };

  // After repo.contracts regenerates contracts (post-resolve), re-baseline the SAME
  // head with `force` so verify runs against the new contracts and the neutral
  // baseline becomes a real drift baseline. The commit comes from the existing
  // (neutral) baseline saved at connect; getRepo gives the installation/branch.
  const onContractsRegenerated = async (repoKey: string, workspaceOrgId: string): Promise<void> => {
    const repo = await gateStore.getRepo(repoKey);
    const baseline = await gateStore.getBaseline(repoKey);
    if (!repo || !baseline) return; // need the link + a known head commit
    await enqueueBaseline({
      repoFullName: repoKey,
      installationId: repo.installationId,
      defaultBranch: repo.defaultBranch,
      commitSha: baseline.commitSha,
      workspaceOrgId,
      force: true,
    });
  };

  // When a workspace's contracts change (KB sync / workspace decision), re-verify
  // every connected repo against the new effective set (forced + quiet — see
  // reverify.ts). Returns the count enqueued, for the sync notification.
  const onWorkspaceContractsChanged = (workspaceOrgId: string): Promise<number> =>
    reverifyWorkspaceRepos(gateStore, enqueueBaseline, workspaceOrgId);

  try {
    // Boot recovery: the in-process worker means a restart abandoned any in-flight
    // job. Reap them so the single-flight key frees and stale "Syncing…" clears.
    const reaped = await jobStore.failOrphaned();
    if (reaped > 0) log.info(`[ee-jobs] reaped ${reaped} orphaned job(s) from a prior run`);
    await hub.start();
    runner = await startWorker({
      db: opts.db,
      connectionString: opts.connectionString,
      masterSecret: opts.masterSecret,
      jobStore,
      onContractsRegenerated,
      onWorkspaceContractsChanged,
    });
  } catch (err) {
    log.error(`[ee-jobs] background services failed to start (jobs will not process): ${(err as Error).message}`);
  }

  // Let OSS adapters (the dashboard decision routes) defer work onto this queue
  // without importing ee/ — e.g. the post-decision contract refresh runs here,
  // off the request path. jobKey debounces a burst of decisions per repo.
  setBackgroundTaskRunner(async (task) => {
    if (!runner) throw new Error('the background job worker is not running');
    if (task.type === REPO_CONTRACTS_TASK && task.repoKey) {
      const key = `${REPO_CONTRACTS_TASK}:${task.repoKey}`;
      const jobId = await ensureContractsJob(REPO_CONTRACTS_TASK, key, task.workspaceOrgId);
      await runner.addJob(
        REPO_CONTRACTS_TASK,
        { jobId, repoKey: task.repoKey, workspaceOrgId: task.workspaceOrgId },
        { jobKey: key, maxAttempts: 1 },
      );
    }
  });

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      setBackgroundTaskRunner(null);
      void runner?.stop().catch(() => {});
      void hub.stop().catch(() => {});
    });
  }

  return {
    jobStore,
    enqueueSync: async (payload, jobKey) => {
      if (!runner) throw new Error('the background job worker is not running');
      await runner.addJob(KNOWLEDGE_SYNC_TASK, payload, { jobKey, maxAttempts: 1 });
    },
    enqueueBaseline,
    enqueueWorkspaceContracts: async (workspaceOrgId) => {
      if (!runner) throw new Error('the background job worker is not running');
      const key = `${WORKSPACE_CONTRACTS_TASK}:${workspaceOrgId}`;
      const jobId = await ensureContractsJob(WORKSPACE_CONTRACTS_TASK, key, workspaceOrgId);
      await runner.addJob(
        WORKSPACE_CONTRACTS_TASK,
        { jobId, workspaceOrgId },
        { jobKey: key, maxAttempts: 1 },
      );
    },
  };
}
