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
import {
  JobStore,
  NotificationStore,
  PendingBaselineStore,
} from '@truecourse/ee-data-store';
import { log } from '@truecourse/core/lib/logger';
import { setBackgroundTaskRunner } from '@truecourse/core/lib/background-tasks';
import type { Runner } from 'graphile-worker';
import { selectGateStore } from '@truecourse/ee-github-app';
import { EventHub } from './events.js';
import { startWorker } from './worker.js';
import {
  enqueueOrPendBaseline,
  replayPendingBaseline,
  drainPendingBaselines,
} from './pending-baseline.js';
import {
  KNOWLEDGE_SYNC_TASK,
  REPO_BASELINE_TASK,
  REPO_CONTRACTS_TASK,
  type SyncJobPayload,
  type BaselineEnqueueRequest,
  type BaselineJobPayload,
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
  const pendingBaselines = new PendingBaselineStore(opts.db);
  const hub = new EventHub(opts.connectionString);

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
  // Coalesces (rather than drops) a push that loses the single-flight race: the
  // dropped request is recorded as the repo's pending follow-up and replayed when
  // the running scan settles (see pending-baseline.ts). Idempotent for a
  // redelivered connect/push of the SAME commit — the replay skips a redundant
  // same-commit pending unless a re-baseline (force) was requested.
  const enqueueBaseline = (req: BaselineEnqueueRequest): Promise<string | null> => {
    if (!runner) throw new Error('the background job worker is not running');
    const r = runner;
    return enqueueOrPendBaseline(
      {
        jobStore,
        pendingBaselines,
        addJob: async (jobId, jreq, jobKey) => {
          await r.addJob(REPO_BASELINE_TASK, { jobId, ...jreq }, { jobKey, maxAttempts: 1 });
        },
      },
      req,
    );
  };

  // After a baseline job settles, replay the repo's coalesced follow-up push (if
  // any). Wired onto the baseline definition's `onSettled` hook, so it runs in
  // BOTH the success and failure paths once the single-flight key is free.
  const onBaselineSettled = (payload: BaselineJobPayload): Promise<void> =>
    replayPendingBaseline(pendingBaselines, enqueueBaseline, payload);

  // Regenerate a repo's contracts after a decision leaves the spec conflict-free:
  // re-baseline the SAME head with `force` (clone → curate → generate → analyze —
  // the baseline's own progress panel shows it) so the previously-skipped contracts
  // are generated. Called directly by the decision task runner below (there is no
  // separate `repo.contracts` job). The commit comes from the existing baseline
  // saved at connect; getRepo gives installation/branch.
  const onContractsRegenerated = async (repoKey: string, workspaceOrgId: string): Promise<void> => {
    const repo = await gateStore.getRepo(repoKey);
    if (!repo) return; // need the link
    const baseline = await gateStore.getBaseline(repoKey);
    if (baseline) {
      await enqueueBaseline({
        repoFullName: repoKey,
        installationId: repo.installationId,
        defaultBranch: repo.defaultBranch,
        commitSha: baseline.commitSha,
        workspaceOrgId,
        force: true,
      });
    }
  };

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
      onBaselineSettled,
    });
    // A crash could have left pending follow-up baselines with no running job to
    // replay them. Now that the reaped keys are free and the worker is up, drain
    // them (per-row best-effort — one bad row must not stop the rest).
    const drained = await drainPendingBaselines(pendingBaselines, enqueueBaseline);
    if (drained > 0) log.info(`[ee-jobs] drained ${drained} pending baseline(s) from a prior run`);
  } catch (err) {
    log.error(`[ee-jobs] background services failed to start (jobs will not process): ${(err as Error).message}`);
  }

  // Let OSS adapters (the dashboard decision routes) defer work onto this queue
  // without importing ee/ — e.g. the post-decision contract refresh runs here,
  // off the request path. jobKey debounces a burst of decisions per repo.
  setBackgroundTaskRunner(async (task) => {
    if (!runner) throw new Error('the background job worker is not running');
    if (task.type === REPO_CONTRACTS_TASK && task.repoKey) {
      // OSS adapters (the shared spec routes) pass only repoKey — resolve the
      // owning workspace from the gate link so the work is scoped + notified.
      const workspaceOrgId =
        task.workspaceOrgId ?? (await gateStore.getRepo(task.repoKey))?.workspaceOrgId;
      if (!workspaceOrgId) {
        log.warn(`[ee-jobs] contract regeneration skipped: ${task.repoKey} is not a connected repo`);
        return;
      }
      // Regenerate contracts by re-baselining directly (clone → curate → generate →
      // analyze, shown by the baseline's own progress panel). There is no separate
      // "refreshing contracts" job/popup — the old wrapper did no work of its own
      // beyond this call, so it was pure redundancy.
      await onContractsRegenerated(task.repoKey, workspaceOrgId);
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
  };
}
