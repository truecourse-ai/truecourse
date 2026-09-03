/**
 * Background jobs + notifications wiring (enterprise, protected by the auth gate).
 *
 * `registerJobs` builds the shared runner over EE's task list and mounts its
 * three routers:
 *   - GET  /api/ee/events            — the per-user SSE stream
 *   - GET  /api/ee/jobs[?active=1]   — job status (seeds the UI's "Syncing" state)
 *   - GET/POST /api/ee/notifications — the durable feed + read-state
 *
 * It returns a `JobsApi` (the shared `JobStore` + an `enqueueBaseline`) that the
 * gate uses to run a repo scan on the background queue instead of inline.
 */

import { openConflicts, type EeServerRegistry } from '@truecourse/shared';
import type { Db } from '@truecourse/db';
import {
  JobStore,
  PendingBaselineStore,
  PendingGuardBaselineStore,
  GuardBackfillMarkerStore,
  type OrphanedJob,
} from '@truecourse/ee-data-store';
import { createJobs, type Jobs } from '@truecourse/jobs';
import { log } from '@truecourse/core/lib/logger';
import { readGuardResult, readGuardLatest } from '@truecourse/core/lib/guard-store';
import { emitRepoLifecycle } from '@truecourse/core/lib/repo-lifecycle';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { getWorkspaceDecisions, type CuratedCorpus } from '@truecourse/core/commands/spec-in-process';
import {
  selectGateStore,
  selectOperatorRepoEnumeration,
  loadGithubAppConfig,
  installationOctokit,
} from '@truecourse/ee-github-app';
import { EventHub } from './events.js';
import { captureJobException, startEeWorker } from './worker.js';
import type { EeErrorContext } from '../observability/sentry.js';
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

export interface RegisterJobsOptions {
  db: Db;
  connectionString: string;
  masterSecret: string;
}

export async function registerJobs(
  registry: EeServerRegistry,
  opts: RegisterJobsOptions,
): Promise<JobsApi> {
  const pendingBaselines = new PendingBaselineStore(opts.db);
  const pendingGuardBaselines = new PendingGuardBaselineStore(opts.db);
  const guardBackfillMarkers = new GuardBackfillMarkerStore(opts.db);

  // A reaped `guard.gate` died before its crash-path catch could complete the
  // PR's in-progress Check — settle each one as the error-styled failure now
  // (best-effort; never blocks boot). Octokit clients are built from the app
  // config per installation, the same way the worker's job bodies do it.
  const settleReapedGates = async (reaped: OrphanedJob[]): Promise<void> => {
    const cfg = loadGithubAppConfig();
    if (!cfg) return;
    const settled = await settleOrphanedGuardGates(
      { octokitFor: (id) => installationOctokit(cfg, id) },
      reaped,
    );
    if (settled > 0) log.info(`[ee-jobs] settled ${settled} stranded gate Check(s) as failures`);
  };

  const jobs: Jobs = createJobs<EeErrorContext>({
    db: opts.db,
    connectionString: opts.connectionString,
    // EE's task list is assembled by `startEeWorker`, which owns the body deps
    // (integration/knowledge stores, pipelines) the definitions close over.
    tasks: [],
    hub: new EventHub(opts.connectionString),
    onReaped: settleReapedGates,
    onException: captureJobException,
    startWorker: ({ rt, connectionString, concurrency }) =>
      startEeWorker({
        rt,
        connectionString,
        concurrency,
        db: opts.db,
        masterSecret: opts.masterSecret,
        onBaselineSettled,
        onGuardGenerateSettled,
        onGuardBaselineSettled,
        onKnowledgeSyncSettled,
      }),
  });
  const jobStore = jobs.jobStore;

  // Mount the routers first — pure wiring, no I/O — so the API surface is always
  // available even if the background services below fail to come up.
  registry.registerRouter('/api/ee/events', jobs.routers.events);
  registry.registerRouter('/api/ee/jobs', jobs.routers.jobs);
  registry.registerRouter('/api/ee/notifications', jobs.routers.notifications);

  // The fire-and-forget backfill's completion (best-effort). Already-resolved
  // unless/until the worker starts and kicks it off inside the try below.
  let backfillSettled: Promise<unknown> = Promise.resolve();

  const gateStore = selectGateStore(opts.db);

  // The pending-buffer enqueues create their tracked row before they reach the
  // queue, so they check the worker up front rather than leaving a queued row
  // behind when there is nothing to run it.
  const requireWorker = (): void => {
    if (!jobs.workerStarted) throw new Error('the background job worker is not running');
  };

  // Single-flight repo-baseline enqueue — shared by connect/push (returned below).
  // Coalesces (rather than drops) a push that loses the single-flight race: the
  // dropped request is recorded as the repo's pending follow-up and replayed when
  // the running scan settles (see pending-baseline.ts). Idempotent for a
  // redelivered connect/push of the SAME commit — the replay skips a redundant
  // same-commit pending unless a re-baseline (force) was requested.
  const enqueueBaseline = (req: BaselineEnqueueRequest): Promise<string | null> => {
    requireWorker();
    return enqueueOrPendBaseline(
      {
        jobStore,
        pendingBaselines,
        addJob: (jobId, jreq, jobKey) => jobs.addJob(REPO_BASELINE_TASK, { jobId, ...jreq }, jobKey),
      },
      req,
    );
  };

  // Pending-buffer-aware guard-baseline enqueue — the merge chain, the
  // post-generate chain, and the deploy backfill all land here. Coalesces (rather
  // than drops) a refresh that loses the single-flight race: the dropped request is
  // recorded as the repo's pending follow-up and replayed when the running run
  // settles (see pending-guard-baseline.ts).
  const enqueueGuardBaseline = (req: GuardBaselineEnqueueRequest): Promise<string | null> => {
    requireWorker();
    return enqueueOrPendGuardBaseline(
      {
        jobStore,
        pendingGuardBaselines,
        addJob: (jobId, jreq, jobKey) =>
          jobs.addJob(GUARD_BASELINE_TASK, { jobId, ...jreq }, jobKey),
      },
      req,
    );
  };

  // Single-flight guard-generate enqueue — the baseline onboarding chain and the
  // dashboard's manual Generate both land here. Keyed per repo.
  const enqueueGuardGenerate = (req: GuardGenerateEnqueueRequest): Promise<string | null> =>
    jobs.singleFlightEnqueue(REPO_GUARD_TASK, req.workspaceOrgId, guardJobKey(req.repoFullName), {
      ...req,
    });

  // Single-flight guard-gate enqueue — the pull-request webhook lands here.
  // Keyed per repo + head SHA: a redelivered webhook for the same head is a
  // no-op, while a new push (new head) queues a fresh gate.
  const enqueueGuardGate = (req: GuardGateEnqueueRequest): Promise<string | null> =>
    jobs.singleFlightEnqueue(
      GUARD_GATE_TASK,
      req.workspaceOrgId,
      guardGateJobKey(req.repoFullName, req.headSha),
      { ...req },
    );

  // Single-flight guard spec-regen enqueue — the checkbox tick lands here. Keyed
  // per repo + head SHA: a duplicate tick for the same head is a no-op.
  const enqueueGuardSpecRegen = (req: GuardSpecRegenEnqueueRequest): Promise<string | null> =>
    jobs.singleFlightEnqueue(
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
  // chain (fires when present); they are exact complements. Anchored at the
  // repo's scanned default-branch baseline (gh_baselines): a commit-less read
  // returns the NEWEST row by createdAt, which can be a PR head's regenerated
  // report — that must never make an un-onboarded repo look onboarded. No
  // baseline → no repo-level guard state (absent is safer than "newest").
  const hasGuardState = async (repoKey: string): Promise<boolean> => {
    const baseline = await gateStore.getBaseline(repoKey);
    if (!baseline) return false;
    return (await readGuardResult(repoKey, baseline.commitSha)) !== null;
  };

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

  // Start the background services (need a live Postgres). A failure here must NOT
  // prevent the dashboard from booting — the HTTP server (auth, reads, capabilities)
  // still comes up; jobs simply don't process until a restart succeeds. Every
  // enqueue throws clearly if the worker never started.
  try {
    await jobs.start();
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
      void jobs.stop().catch(() => {});
    });
  }

  return {
    jobStore,
    enqueueSync: (payload, jobKey) => jobs.addJob(KNOWLEDGE_SYNC_TASK, { ...payload }, jobKey),
    enqueueEstimate: (payload, jobKey) =>
      jobs.addJob(KNOWLEDGE_ESTIMATE_TASK, { ...payload }, jobKey),
    enqueueBaseline,
    enqueueGuardGenerate,
    enqueueGuardGate,
    enqueueGuardSpecRegen,
    enqueueGuardBaseline,
    workerStarted: jobs.workerStarted,
    backfillSettled,
  };
}
