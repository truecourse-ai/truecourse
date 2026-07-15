/**
 * Background jobs + notifications wiring (enterprise, protected by the auth gate).
 *
 * `registerJobs` reaps orphaned jobs from a prior run, starts the LISTEN/NOTIFY
 * event hub + the in-process graphile-worker runner, and mounts three routers:
 *   - GET  /api/ee/events            — the per-user SSE stream
 *   - GET  /api/ee/jobs[?active=1]   — job status (seeds the UI's "Syncing" state)
 *   - GET/POST /api/ee/notifications — the durable feed + read-state
 *
 * It returns a `JobsApi` (the shared `JobStore` + an `enqueueBaseline`) that the
 * gate uses to run a repo scan on the background queue instead of inline.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { openConflicts, type AuthUser, type EeServerRegistry } from '@truecourse/shared';
import type { EeDb } from '@truecourse/ee-db';
import {
  JobStore,
  NotificationStore,
  ActiveJobExistsError,
  PendingBaselineStore,
  PendingGuardBaselineStore,
  GuardBackfillMarkerStore,
} from '@truecourse/ee-data-store';
import { log } from '@truecourse/core/lib/logger';
import { readGuardResult, readGuardLatest } from '@truecourse/core/lib/guard-store';
import { emitRepoLifecycle } from '@truecourse/core/lib/repo-lifecycle';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { getWorkspaceDecisions, type CuratedCorpus } from '@truecourse/core/commands/spec-in-process';
import type { Runner } from 'graphile-worker';
import {
  selectGateStore,
  selectOperatorRepoEnumeration,
  loadGithubAppConfig,
  installationOctokit,
} from '@truecourse/ee-github-app';
import { EventHub } from './events.js';
import { startWorker } from './worker.js';
import type { JobOutcomeStatus } from './harness.js';
import {
  chainGuardOnboarding,
  chainGuardBaselineRefresh,
  generateWasBlocked,
} from './guard-chain.js';
import { chainInheritanceRipple, type RippleRepo } from './knowledge-chain.js';
import { settleOrphanedGuardGates } from './orphans.js';
import {
  enqueueOrPendBaseline,
  replayPendingBaseline,
  drainPendingBaselines,
} from './pending-baseline.js';
import {
  enqueueOrPendGuardBaseline,
  replayPendingGuardBaseline,
  drainPendingGuardBaselines,
  type GuardBaselineSettleOutcome,
} from './pending-guard-baseline.js';
import { runGuardBackfill } from './guard-backfill.js';
import {
  KNOWLEDGE_SYNC_TASK,
  KNOWLEDGE_ESTIMATE_TASK,
  REPO_BASELINE_TASK,
  REPO_GUARD_TASK,
  GUARD_GATE_TASK,
  GUARD_SPEC_REGEN_TASK,
  GUARD_BASELINE_TASK,
  guardJobKey,
  guardGateJobKey,
  guardSpecRegenJobKey,
  guardBaselineJobKey,
  type SyncJobPayload,
  type EstimateJobPayload,
  type BaselineEnqueueRequest,
  type BaselineJobPayload,
  type GuardGenerateEnqueueRequest,
  type GuardGateEnqueueRequest,
  type GuardSpecRegenEnqueueRequest,
  type GuardBaselineEnqueueRequest,
  type GuardBaselineJobPayload,
} from './constants.js';

function orgIdOf(req: Request): string | null {
  return (req as Request & { eeUser?: AuthUser }).eeUser?.organizationId ?? null;
}

/** The job surface other modules enqueue onto: the shared store + the enqueue. */
export interface JobsApi {
  jobStore: JobStore;
  /** Enqueue a connector sync (maxAttempts:1 — a failure is terminal, see worker.ts). */
  enqueueSync(payload: SyncJobPayload, jobKey: string): Promise<void>;
  /** Enqueue Stage 1 of a sync — the cache-aware cost estimate (maxAttempts:1). */
  enqueueEstimate(payload: EstimateJobPayload, jobKey: string): Promise<void>;
  /**
   * Enqueue an initial/refresh repo scan (connect + default-branch push). Single-
   * flight per repo: returns the new job id, or null when a scan is already
   * running for that repo (so a redelivered push / re-connect is a no-op).
   */
  enqueueBaseline(req: BaselineEnqueueRequest): Promise<string | null>;
  /**
   * Enqueue a hosted guard-scenario generate for a connected repo (the baseline
   * onboarding chain + the dashboard's manual Generate). Single-flight per repo:
   * returns the new job id, or null when a generate is already running.
   */
  enqueueGuardGenerate(req: GuardGenerateEnqueueRequest): Promise<string | null>;
  /**
   * Enqueue a guard gate run for a PR head (the pull-request webhook). Single-
   * flight per repo + head SHA: returns the new job id, or null when a gate is
   * already running for that head (so a redelivered webhook is a no-op).
   */
  enqueueGuardGate(req: GuardGateEnqueueRequest): Promise<string | null>;
  /**
   * Enqueue a spec-change guard regen for a PR head (the checkbox tick). Single-
   * flight per repo + head SHA: returns the new job id, or null when a regen is
   * already running for that head.
   */
  enqueueGuardSpecRegen(req: GuardSpecRegenEnqueueRequest): Promise<string | null>;
  /**
   * Enqueue a guard-baseline refresh for a repo's default branch (the merge chain,
   * the post-generate chain, and the deploy backfill). Pending-buffer-aware: when a
   * refresh is already in flight for the repo, the newer request coalesces onto a
   * per-repo pending row (latest commit wins) and is replayed when the running run
   * settles — returns the new job id, or null when coalesced/failed-to-boot.
   */
  enqueueGuardBaseline(req: GuardBaselineEnqueueRequest): Promise<string | null>;
  /**
   * Whether the background worker actually started. False when the background
   * services failed to come up (jobs won't process until a restart) — the
   * `guard` capability gates on this so it is never advertised optimistically.
   */
  workerStarted: boolean;
  /**
   * Resolves when the fire-and-forget deploy-time guard backfill settles (best-
   * effort; already resolved when the worker never started). Boot does NOT await
   * it — exposed so callers/tests can join the background work deterministically.
   */
  backfillSettled: Promise<unknown>;
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
  const pendingGuardBaselines = new PendingGuardBaselineStore(opts.db);
  const guardBackfillMarkers = new GuardBackfillMarkerStore(opts.db);
  const hub = new EventHub(opts.connectionString);

  // Mount the routers first — pure wiring, no I/O — so the API surface is always
  // available even if the background services below fail to come up.
  registry.registerRouter('/api/ee/events', createEventsRouter(hub));
  registry.registerRouter('/api/ee/jobs', createJobsRouter(jobStore));
  registry.registerRouter('/api/ee/notifications', createNotificationsRouter(notifications));

  // Start the background services (need a live Postgres). A failure here must NOT
  // prevent the dashboard from booting — the HTTP server (auth, reads, capabilities)
  // still comes up; jobs simply don't process until a restart succeeds. enqueueBaseline
  // throws clearly if the worker never started.
  let runner: Runner | null = null;
  // The fire-and-forget backfill's completion (best-effort). Already-resolved
  // unless/until the worker starts and kicks it off inside the try below.
  let backfillSettled: Promise<unknown> = Promise.resolve();

  const gateStore = selectGateStore(opts.db);

  // Single-flight repo-baseline enqueue — shared by connect/push (returned below).
  // Closes over the `runner` assigned just below.
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

  // Pending-buffer-aware guard-baseline enqueue — the merge chain, the
  // post-generate chain, and the deploy backfill all land here. Coalesces (rather
  // than drops) a refresh that loses the single-flight race: the dropped request is
  // recorded as the repo's pending follow-up and replayed when the running run
  // settles (see pending-guard-baseline.ts). Closes over the `runner` below.
  const enqueueGuardBaseline = (req: GuardBaselineEnqueueRequest): Promise<string | null> => {
    if (!runner) throw new Error('the background job worker is not running');
    const r = runner;
    return enqueueOrPendGuardBaseline(
      {
        jobStore,
        pendingGuardBaselines,
        addJob: async (jobId, jreq, jobKey) => {
          await r.addJob(GUARD_BASELINE_TASK, { jobId, ...jreq }, { jobKey, maxAttempts: 1 });
        },
      },
      req,
    );
  };

  // Single-flight enqueue: one active job per key — a concurrent request is a
  // no-op (null), so a redelivered webhook / double click / chain race never
  // queues a duplicate. The `jobId` is stamped into the payload for the harness.
  // The payload is also persisted on the row, so boot recovery can settle what a
  // crashed run left dangling (e.g. a gate's stranded PR Check — see orphans.ts).
  const singleFlightEnqueue = async (
    task: string,
    org: string,
    key: string,
    payload: Record<string, unknown>,
  ): Promise<string | null> => {
    if (!runner) throw new Error('the background job worker is not running');
    let job;
    try {
      job = await jobStore.create({ org, type: task, key, payload });
    } catch (err) {
      if (err instanceof ActiveJobExistsError) return null;
      throw err;
    }
    try {
      await runner.addJob(task, { jobId: job.id, ...payload }, { jobKey: key, maxAttempts: 1 });
    } catch (err) {
      // No graphile job exists to run (or settle) the row we just created — a
      // 'queued' row would hold the single-flight key until the next restart's
      // boot recovery, turning every request for this key until then into a
      // bogus "already running" null. Mark it terminal, then rethrow.
      await jobStore
        .markFailed(job.id, (err as Error).message)
        .catch(() => undefined);
      throw err;
    }
    return job.id;
  };

  // Single-flight guard-generate enqueue — the baseline onboarding chain and the
  // dashboard's manual Generate both land here. Keyed per repo.
  const enqueueGuardGenerate = (req: GuardGenerateEnqueueRequest): Promise<string | null> =>
    singleFlightEnqueue(REPO_GUARD_TASK, req.workspaceOrgId, guardJobKey(req.repoFullName), {
      ...req,
    });

  // Single-flight guard-gate enqueue — the pull-request webhook lands here.
  // Keyed per repo + head SHA: a redelivered webhook for the same head is a
  // no-op, while a new push (new head) queues a fresh gate.
  const enqueueGuardGate = (req: GuardGateEnqueueRequest): Promise<string | null> =>
    singleFlightEnqueue(
      GUARD_GATE_TASK,
      req.workspaceOrgId,
      guardGateJobKey(req.repoFullName, req.headSha),
      { ...req },
    );

  // Single-flight guard spec-regen enqueue — the checkbox tick lands here. Keyed
  // per repo + head SHA: a duplicate tick for the same head is a no-op.
  const enqueueGuardSpecRegen = (req: GuardSpecRegenEnqueueRequest): Promise<string | null> =>
    singleFlightEnqueue(
      GUARD_SPEC_REGEN_TASK,
      req.workspaceOrgId,
      guardSpecRegenJobKey(req.repoFullName, req.headSha),
      { ...req },
    );

  // After a baseline job settles, replay the repo's coalesced follow-up push (if
  // any — BOTH outcomes), then — on SUCCESS only — chain the guard onboarding:
  // the scan just persisted the corpus, and a repo with stored guard state is
  // already onboarded (refresh-on-merge is issue 06). Wired onto the baseline
  // definition's `onSettled` hook, which runs once the single-flight key is free.
  // Whether a repo already has hosted guard state (a stored generate report) —
  // shared by the onboarding chain (fires when absent) and the baseline-refresh
  // chain (fires when present); they are exact complements.
  const hasGuardState = async (repoKey: string): Promise<boolean> =>
    (await readGuardResult(repoKey)) !== null;

  const onBaselineSettled = async (
    payload: BaselineJobPayload,
    outcome: JobOutcomeStatus,
  ): Promise<void> => {
    await replayPendingBaseline(pendingBaselines, enqueueBaseline, payload);
    // Complementary chains: a repo with NO guard state onboards (generate); a repo
    // that ALREADY has scenarios refreshes its baseline against current main. The
    // spec scan just re-materialized the corpus, so the baseline runs the newest.
    await chainGuardOnboarding({ hasGuardState, enqueueGuardGenerate }, payload, outcome);
    await chainGuardBaselineRefresh({ hasGuardState, enqueueGuardBaseline }, payload, outcome);
    // The scan re-curated the corpus — tell any open Spec tab to refresh (routed
    // by the dashboard server into the repo's room as `spec:complete`).
    if (outcome === 'succeeded') await emitRepoLifecycle(payload.repoFullName, 'scan');
  };

  // After a guard-generate settles: on success a fresh generate just wrote
  // scenarios, so warm the baseline (skip the first PR's lazy base run). Reuses the
  // refresh chain — hasGuardState is now true, so it fires exactly once.
  const onGuardGenerateSettled = async (
    payload: GuardGenerateEnqueueRequest & { jobId: string },
    outcome: JobOutcomeStatus,
    result?: unknown,
  ): Promise<void> => {
    // A settled generate rewrote the report (scenarios on success, an
    // open-conflicts report when blocked) — refresh any open Scenarios tab either
    // way, BEFORE the blocked suppression below (that guards only the run chain).
    if (outcome === 'succeeded') await emitRepoLifecycle(payload.repoFullName, 'guard-generate');
    // A generate BLOCKED on open spec conflicts persisted an open-conflicts report
    // (hasGuardState is now true) but saved NO scenarios — chaining a baseline run
    // would strand a run row against an empty Scenarios tab. Suppress it.
    if (generateWasBlocked(result)) return;
    await chainGuardBaselineRefresh({ hasGuardState, enqueueGuardBaseline }, payload, outcome);
  };

  // After a guard-baseline settles (success OR failure): replay the repo's
  // coalesced follow-up refresh, if any (latest-commit-wins). The run's verdict
  // status decides whether a redundant same-commit pending drops or replays — a
  // `no-verdict`/failed run leaves it to replay so a transient error self-heals.
  const onGuardBaselineSettled = async (
    payload: GuardBaselineJobPayload,
    settled: GuardBaselineSettleOutcome,
  ): Promise<void> => {
    await replayPendingGuardBaseline(pendingGuardBaselines, enqueueGuardBaseline, payload, settled);
    // A successful run wrote guard/LATEST — tell any open Runs tab to refresh.
    if (settled.outcome === 'succeeded') await emitRepoLifecycle(payload.repoFullName, 'guard-run');
  };

  // The workspace's open spec conflicts (the shared `openConflicts` derivation the
  // repo gate uses) — 0 when there is no corpus yet. The ripple skips a workspace
  // that still has any conflict open (repos stay on the last clean spec).
  const workspaceOpenConflicts = async (org: string): Promise<number> => {
    const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus');
    if (!corpus) return 0;
    const decisions = await getWorkspaceDecisions(org);
    return openConflicts(corpus, decisions).length;
  };

  // The org's connected repos that have a baseline to re-scan — the ripple targets.
  // A repo with no baseline yet (never scanned) is skipped: there is nothing to
  // re-inherit into and no commit to key by.
  const listReposToRipple = async (org: string): Promise<RippleRepo[]> => {
    const links = await gateStore.listReposForWorkspace(org);
    const repos: RippleRepo[] = [];
    for (const link of links) {
      const baseline = await gateStore.getBaseline(link.repoFullName);
      if (!baseline) continue;
      repos.push({
        repoFullName: link.repoFullName,
        installationId: link.installationId,
        defaultBranch: link.defaultBranch,
        commitSha: baseline.commitSha,
      });
    }
    return repos;
  };

  // After a knowledge.sync (processing) job succeeds WITH a corpus change and no open
  // spec conflict, ripple a baseline re-scan to the org's connected repos — they fold
  // the workspace layer into their own spec, so a changed corpus makes their inherited
  // spec stale. Best-effort; single-flight losses coalesce onto pending-baseline.
  const onKnowledgeSyncSettled = async (
    payload: SyncJobPayload,
    outcome: JobOutcomeStatus,
    result?: unknown,
  ): Promise<void> => {
    await chainInheritanceRipple(
      { openConflicts: workspaceOpenConflicts, listRepos: listReposToRipple, enqueueBaseline },
      payload,
      outcome,
      result,
    );
  };

  try {
    // Boot recovery: the in-process worker means a restart abandoned any in-flight
    // job. Reap them so the single-flight key frees and stale "Syncing…" clears.
    const reaped = await jobStore.failOrphaned();
    if (reaped.length > 0) {
      log.info(`[ee-jobs] reaped ${reaped.length} orphaned job(s) from a prior run`);
      // A reaped guard.gate died before its crash-path catch could complete the
      // PR's in-progress Check — settle each one as the error-styled failure now
      // (best-effort; never blocks boot). Octokit clients are built from the app
      // config per installation, the same way the worker's job bodies do it.
      const cfg = loadGithubAppConfig();
      if (cfg) {
        const settled = await settleOrphanedGuardGates(
          { octokitFor: (id) => installationOctokit(cfg, id) },
          reaped,
        );
        if (settled > 0) log.info(`[ee-jobs] settled ${settled} stranded gate Check(s) as failures`);
      }
    }
    await hub.start();
    runner = await startWorker({
      db: opts.db,
      connectionString: opts.connectionString,
      masterSecret: opts.masterSecret,
      jobStore,
      onBaselineSettled,
      onGuardGenerateSettled,
      onGuardBaselineSettled,
      onKnowledgeSyncSettled,
    });
    // A crash could have left pending follow-up baselines with no running job to
    // replay them. Now that the reaped keys are free and the worker is up, drain
    // them (per-row best-effort — one bad row must not stop the rest).
    const drained = await drainPendingBaselines(pendingBaselines, enqueueBaseline);
    if (drained > 0) log.info(`[ee-jobs] drained ${drained} pending baseline(s) from a prior run`);
    const drainedGuard = await drainPendingGuardBaselines(pendingGuardBaselines, enqueueGuardBaseline);
    if (drainedGuard > 0)
      log.info(`[ee-jobs] drained ${drainedGuard} pending guard-baseline(s) from a prior run`);

    // Deploy-time guard backfill (issue 06): one-time generate + baseline for every
    // already-connected repo, so existing fleets don't pay generate-plus-double-run
    // inside their first PR. Fire-and-forget — best-effort, must NEVER block or fail
    // boot (its own internals never throw; the .catch is belt-and-braces).
    backfillSettled = runGuardBackfill({
      listRepos: () => selectOperatorRepoEnumeration(opts.db).listAllRepos(),
      baselineCommit: async (repo) => (await gateStore.getBaseline(repo))?.commitSha ?? null,
      hasScenarios: hasGuardState,
      hasBaseline: async (repoKey) => (await readGuardLatest(repoKey)) !== null,
      isBackfilled: (repo) => guardBackfillMarkers.isMarked(repo),
      markBackfilled: (repo) => guardBackfillMarkers.mark(repo),
      enqueueGuardGenerate,
      enqueueGuardBaseline,
    })
      .then((s) => {
        if (s.generateEnqueued + s.baselineEnqueued > 0)
          log.info(
            `[ee-jobs] guard backfill enqueued ${s.generateEnqueued} generate(s) + ${s.baselineEnqueued} baseline(s)`,
          );
      })
      .catch((err) => log.warn(`[ee-jobs] guard backfill failed: ${(err as Error).message}`));
    // Deliberately NOT awaited: boot must not block on the backfill (it is exposed
    // as `backfillSettled` for callers/tests that want to join it).
  } catch (err) {
    log.error(`[ee-jobs] background services failed to start (jobs will not process): ${(err as Error).message}`);
  }

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
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
    enqueueEstimate: async (payload, jobKey) => {
      if (!runner) throw new Error('the background job worker is not running');
      await runner.addJob(KNOWLEDGE_ESTIMATE_TASK, payload, { jobKey, maxAttempts: 1 });
    },
    enqueueBaseline,
    enqueueGuardGenerate,
    enqueueGuardGate,
    enqueueGuardSpecRegen,
    enqueueGuardBaseline,
    workerStarted: runner !== null,
    backfillSettled,
  };
}
