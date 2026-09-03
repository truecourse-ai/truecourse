/**
 * The in-process graphile-worker runner + the background job definitions.
 *
 * `run()` installs graphile-worker's own schema and starts polling/LISTENing for
 * jobs. Each job type is a {@link JobDefinition} (type + title + steps + run body
 * + notification wording); the shared {@link executeJob} harness owns the whole
 * lifecycle envelope identically for all of them — marking the `jobs` row
 * running → succeeded/failed with live SSE progress, seeding + advancing the
 * stepped checklist, posting the standardized success/failure notification, and
 * capturing failures to Sentry. A job body only does the work and returns its
 * result + success notification.
 *
 * Jobs are enqueued with `maxAttempts: 1` (see index.ts): a failure is terminal
 * and surfaced to the user, who can re-run. So a thrown body = a permanent fail,
 * never a silent retry that would double-run and fight the single-flight key.
 */

import { run, type Runner, type Task } from 'graphile-worker';
import type { Db } from '@truecourse/db';
import { JobStore, NotificationStore, PgKnowledgeStore, WorkspaceSettingsStore } from '@truecourse/ee-data-store';
import { runWithTrace, type TraceContext } from '@truecourse/ee-llm';
import { log } from '@truecourse/core/lib/logger';
import {
  runBaseline,
  loadGithubAppConfig,
  createGithubAuth,
  installationOctokit,
  selectGateStore,
  splitRepo,
  updateComment,
  renderGuardSpecComment,
  createGuardGatePipeline,
  defaultGuardOnboardingPipeline,
  defaultGuardGatePipeline,
  defaultGuardBaselinePipeline,
  defaultGuardHeadRegenPipeline,
  notifierFromConfig,
  postGuardGateErrorCheck,
  wantsNotification,
  repoGuardCoverageUrl,
  type EmailNotifier,
  type BaselineResult,
  type GuardOnboardingPipeline,
  type GuardGatePipeline,
  type GuardBaselinePipeline,
  type GuardBaselineResult,
  type GuardGateRunRequest,
  type GuardGateCorpus,
  type GuardHeadRegenPipeline,
  type OctokitClient,
} from '@truecourse/ee-github-app';
import { getGuardStore } from '@truecourse/core/lib/guard-store';
import { getGuardExecutor } from '@truecourse/core/lib/guard-executor';
import type { IntegrationPendingView, NotificationLevel } from '@truecourse/shared';
import { upstreamStatusOf } from '../observability/sentry.js';
import { IntegrationStore } from '../integrations/store.js';
import { CONNECTORS } from '../knowledge/connectors/registry.js';
import { connectorConfig, type ConnectorKind } from '../knowledge/connectors/types.js';
import {
  processWorkspaceKnowledge,
  syncSource,
  SYNC_MSG_CONSOLIDATE,
  type WorkspaceSyncEstimate,
} from '../knowledge/sync.js';
import {
  getWorkspaceDecisions,
  corpusContentSha,
  CURATE_STEPS,
  type CuratedCorpus,
} from '@truecourse/core/commands/spec-in-process';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { GUARD_GENERATE_STEPS } from '@truecourse/core/commands/guard-in-process';
import { StepTracker, type AnalysisProgressPayload } from '@truecourse/core/progress';
import { JobStepTracker } from './steps.js';
import {
  executeJob,
  type JobDefinition,
  type JobNotification,
  type JobOutcomeStatus,
  type JobRuntime,
} from './harness.js';
import {
  KNOWLEDGE_SYNC_TASK,
  KNOWLEDGE_SYNC_TITLE,
  KNOWLEDGE_SYNC_STEPS,
  KNOWLEDGE_ESTIMATE_TASK,
  KNOWLEDGE_ESTIMATE_TITLE,
  KNOWLEDGE_ESTIMATE_STEPS,
  REPO_BASELINE_TASK,
  REPO_BASELINE_TITLE,
  REPO_BASELINE_STEPS,
  REPO_GUARD_TASK,
  REPO_GUARD_TITLE,
  REPO_GUARD_STEPS,
  GUARD_GATE_TASK,
  GUARD_GATE_TITLE,
  GUARD_GATE_STEPS,
  GUARD_SPEC_REGEN_TASK,
  GUARD_SPEC_REGEN_TITLE,
  GUARD_SPEC_REGEN_STEPS,
  GUARD_BASELINE_TASK,
  GUARD_BASELINE_TITLE,
  GUARD_BASELINE_STEPS,
  type SyncJobPayload,
  type EstimateJobPayload,
  type BaselineJobPayload,
  type GuardGenerateJobPayload,
  type GuardGateJobPayload,
  type GuardSpecRegenJobPayload,
  type GuardBaselineJobPayload,
} from './constants.js';
import { guardGateLimiter } from './guard-gate-limiter.js';
import type { GuardBaselineSettleOutcome } from './pending-guard-baseline.js';

/**
 * Bridge an OSS in-process StepTracker onto one EE job step: each inner-phase
 * transition is forwarded as the EE step's inline detail, so the popup shows the
 * same numbered sub-phases the OSS popup does. `stepDefs` is the inner phase set
 * to mirror — CURATE_STEPS (spec scan) by default. Returns a StepTracker to hand
 * to the callee.
 */
function stepBridge(
  eeTracker: JobStepTracker,
  stepKey: string,
  stepDefs: ReadonlyArray<{ key: string; label: string }> = CURATE_STEPS,
): StepTracker {
  return new StepTracker((p: AnalysisProgressPayload) => {
    const text = p.detail ? `${p.step} · ${p.detail}` : p.step;
    void eeTracker.detail(stepKey, text);
  }, [...stepDefs]);
}

export interface StartWorkerDeps {
  db: Db;
  connectionString: string;
  masterSecret: string;
  jobStore: JobStore;
  /**
   * Called after a `repo.baseline` job goes terminal (success OR failure), once
   * its single-flight key is free — replays any coalesced follow-up push for the
   * repo (see pending-baseline.ts) and, on SUCCESS only, chains the guard
   * onboarding (see guard-chain.ts). Wired only onto the baseline definition.
   */
  onBaselineSettled?: (payload: BaselineJobPayload, outcome: JobOutcomeStatus) => Promise<void>;
  /**
   * Called after a `knowledge.sync` (processing) job goes terminal. On SUCCESS with
   * no open spec conflict AND a corpus that actually changed, processing just
   * re-consolidated the workspace corpus, so ripple a baseline re-scan to the org's
   * connected repos (they inherit the workspace layer — see knowledge-chain.ts). The
   * run's `result` carries the `corpusChanged` flag. Wired only onto the processing
   * definition.
   */
  onKnowledgeSyncSettled?: (
    payload: SyncJobPayload,
    outcome: JobOutcomeStatus,
    result?: unknown,
  ) => Promise<void>;
  /**
   * Called after a `repo.guard` (generate) job goes terminal. On SUCCESS, a fresh
   * generate just wrote scenarios — chain a guard-baseline refresh so the first PR
   * gate diffs against a warm baseline instead of paying a lazy base run (issue 06).
   * Wired only onto the guard-generate definition.
   */
  onGuardGenerateSettled?: (
    payload: GuardGenerateJobPayload,
    outcome: JobOutcomeStatus,
    result?: unknown,
  ) => Promise<void>;
  /**
   * Called after a `guard.baseline` job goes terminal (success OR failure), once
   * its single-flight key is free — replays any coalesced follow-up refresh for
   * the repo (see pending-guard-baseline.ts). Receives the run's verdict status
   * alongside the outcome so the replay can tell a settled commit from a
   * `no-verdict` one. Wired only onto the guard-baseline definition.
   */
  onGuardBaselineSettled?: (
    payload: GuardBaselineJobPayload,
    settled: GuardBaselineSettleOutcome,
  ) => Promise<void>;
}

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
 * Word the repo-scan completion notification to match what the run actually
 * produced. Open conflicts mean a human should resolve them before the spec is
 * canonical, so we point the user at the conflicts rather than claiming a clean
 * scan.
 */
function baselineNotice(
  repoFullName: string,
  result: BaselineResult,
): { level: NotificationLevel; title: string; body: string } {
  if (result.openConflicts > 0) {
    const n = result.openConflicts;
    return {
      level: 'warning',
      title: 'Repository scanned — conflicts to resolve',
      body: `${repoFullName} — spec is ready, but ${n} open conflict${n === 1 ? '' : 's'} must be resolved.`,
    };
  }
  return {
    level: 'success',
    title: 'Repository scan complete',
    body: `${repoFullName} — spec & Code Quality baseline are ready.`,
  };
}

/**
 * The shared "scenario generation blocked on open spec conflicts" in-app notice —
 * a needs-attention WARNING, not a failure. Wording is identical for the onboarding
 * generate and the spec-change regen; both point the user at the repo's Spec Guard
 * Coverage tab where the conflicts are resolved.
 */
function conflictsBlockedNotification(repoFullName: string, conflicts: number): JobNotification {
  const s = conflicts === 1 ? '' : 's';
  return {
    level: 'warning',
    title: `Scenario generation blocked — ${conflicts} spec conflict${s} to resolve`,
    body: `${repoFullName} — resolve the ${conflicts} open spec conflict${s} in the Spec Guard → Coverage tab, then scenario generation re-runs.`,
    data: { repoFullName, openConflicts: conflicts },
  };
}

/** The conflicts-email injection seam the guard generate/spec-regen jobs share:
 *  tests pass fakes; production resolves the notifier from the app config per
 *  invocation (a key added after boot is honored) and the origin from the env. */
export interface ConflictsEmailSeam {
  notifier?: EmailNotifier;
  appUrl?: string;
}

/**
 * Fire the "generation blocked" email — best-effort, gated exactly like the gate's
 * failure email: the repo link must carry notify addresses AND have the `conflicts`
 * pref on. A missing notifier (Resend unconfigured) or a pref-off is a silent no-op;
 * the job still posts its in-app warning. The deep link (repo Spec Guard Coverage
 * tab) is resolved best-effort — omitted when the repo has no dashboard slug yet.
 */
async function emailConflictsBlocked(
  db: Db,
  repoFullName: string,
  conflicts: number,
  seam: ConflictsEmailSeam,
  cfg: Parameters<typeof notifierFromConfig>[0],
): Promise<void> {
  const notifier = seam.notifier ?? notifierFromConfig(cfg);
  if (!notifier) return;
  const link = await selectGateStore(db).getRepo(repoFullName);
  const notifyEmails = link?.notifyEmails ?? [];
  if (!link || notifyEmails.length === 0 || !wantsNotification(link, 'conflicts')) return;
  const appUrl = seam.appUrl ?? process.env.WORKOS_APP_URL ?? 'http://localhost:3000';
  const dashboardUrl = await repoGuardCoverageUrl(appUrl, repoFullName).catch(() => undefined);
  void notifier.sendGuardConflictsBlocked(notifyEmails, { repoFullName, conflicts, dashboardUrl });
}

/**
 * Turn a sweep's estimate into the pending record + the completion toast. An
 * empty delta (nothing new/changed/removed) clears pending and reports the source
 * is up to date; a non-empty delta persists the delta + the full estimate (the
 * Process confirm dialog opens from it) and names ONLY the delta in the toast —
 * the cost is seen and confirmed at Process time, never at sync time.
 */
export function pendingFromEstimate(
  estimate: WorkspaceSyncEstimate,
  connectorName: string,
  sweptAt: string,
): { pending: IntegrationPendingView | null; notification: JobNotification } {
  const { delta, ...estimateOnly } = estimate;
  if (delta.new + delta.changed + delta.removed === 0) {
    return {
      pending: null,
      notification: {
        level: 'success',
        title: 'Sync complete',
        body: `${connectorName} is up to date — nothing to process.`,
      },
    };
  }
  return {
    pending: { delta, estimate: estimateOnly, sweptAt },
    notification: {
      level: 'success',
      title: 'Sync complete',
      body: `${estimateOnly.subjectLabel ?? ''} to process.`,
    },
  };
}

/** Shared deps the workspace knowledge job bodies close over (built in startWorker). */
interface JobBodyDeps {
  db: Db;
  integrations: IntegrationStore;
  knowledge: PgKnowledgeStore;
}

// --- Job definitions -------------------------------------------------

/**
 * Processing stage (workspace-scoped): load the UNION of every synced source's
 * stored docs from the ledger (NO connector I/O) → consolidate the combined corpus
 * once (folding the workspace decisions) → clear ALL connectors' pending records
 * (their swept content was consumed). `kind` in the payload is attribution only.
 */
function knowledgeSyncJob(
  d: JobBodyDeps,
  onSettled?: (payload: SyncJobPayload, outcome: JobOutcomeStatus, result?: unknown) => Promise<void>,
): JobDefinition<SyncJobPayload> {
  return {
    type: KNOWLEDGE_SYNC_TASK,
    title: KNOWLEDGE_SYNC_TITLE,
    steps: KNOWLEDGE_SYNC_STEPS,
    org: (p) => p.org,
    // On a successful, conflict-free process that CHANGED the corpus, the settle
    // hook ripples a baseline re-scan to the org's connected repos (knowledge-
    // chain.ts) — best-effort, never throws. `corpusChanged` rides the result.
    onSettled: onSettled ? (ctx, outcome, result) => onSettled(ctx.payload, outcome, result) : undefined,
    sentry: (err, p) => ({
      component: 'knowledge',
      orgId: p.org,
      connector: p.kind,
      upstreamStatus: upstreamStatusOf(err),
      route: 'worker knowledge.sync',
    }),
    async run(ctx) {
      const { org } = ctx.payload;
      // Fold the workspace decisions (force excludes/includes, verdicts) into curate.
      const decisions = await getWorkspaceDecisions(org);

      // Content signature of the corpus BEFORE re-consolidating — compared with the
      // after signature so the settle hook skips the repo ripple when this process
      // changed nothing meaningful (volatile timestamps are excluded from the sha).
      const before = corpusContentSha(
        await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus'),
      );

      const result = await processWorkspaceKnowledge(org, d.knowledge, {
        decisions,
        onProgress: async (current, total, message) => {
          if (message === SYNC_MSG_CONSOLIDATE) await ctx.phase('consolidate');
          else await ctx.phase('fetch', total > 0 ? `${current}/${total} docs` : undefined);
        },
        // Curate sub-phases surface on the "consolidate" step (N/M docs detail).
        tracker: stepBridge(ctx.tracker, 'consolidate', CURATE_STEPS),
      });

      const after = corpusContentSha(
        await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus'),
      );

      // Processing consumed the swept work for EVERY source — clear all pending
      // records so no source's Process button lingers until the next sweep.
      for (const connector of Object.values(CONNECTORS)) {
        if (connector) await d.integrations.setPending(org, connector.kind, null);
      }
      return {
        result: { synced: result.synced, corpusChanged: before !== after },
        notification: {
          level: 'success',
          title: 'Processing complete',
          body: `Processed ${result.synced} document${result.synced === 1 ? '' : 's'}.`,
          data: { synced: result.synced },
        },
      };
    },
    onError: (err) => ({
      level: 'error',
      title: 'Processing failed',
      body: 'Processing didn’t finish. Open Details for the technical reason.',
      data: { detail: err.message },
    }),
  };
}

/** Sync-now stage: fetch the source, PERSIST every body + reconcile the ledger
 *  (Sources fills now), and price the classify+consolidate stage (no LLM). A
 *  non-empty delta persists a pending record + toasts the work to process; an empty
 *  delta clears any pending record + toasts "up to date". The estimate rides the
 *  job's result; the Process button dispatches the union consolidation (`/sync`). */
function knowledgeEstimateJob(d: JobBodyDeps): JobDefinition<EstimateJobPayload> {
  return {
    type: KNOWLEDGE_ESTIMATE_TASK,
    title: KNOWLEDGE_ESTIMATE_TITLE,
    steps: KNOWLEDGE_ESTIMATE_STEPS,
    org: (p) => p.org,
    sentry: (err, p) => ({
      component: 'knowledge',
      orgId: p.org,
      connector: p.kind,
      upstreamStatus: upstreamStatusOf(err),
      route: 'worker knowledge.estimate',
    }),
    async run(ctx) {
      const { org, kind } = ctx.payload;
      const connector = CONNECTORS[kind as ConnectorKind];
      if (!connector) throw new Error(`Unknown connector: ${kind}`);
      const conn = await d.integrations.getConnection(org, kind);
      if (!conn?.token) throw new Error(`No ${kind} connection.`);
      const cfg = connectorConfig(connector, conn.config, conn.token);

      await ctx.phase('fetch');
      // Sync now: fetch + persist bodies + reconcile the ledger, and return the
      // classify+consolidate estimate (no LLM). Sources fills the moment this returns.
      const estimate = await syncSource(org, d.knowledge, connector, cfg, {
        onFetchProgress: (done, total) =>
          ctx.phase('fetch', total > 0 ? `${done}/${total} docs` : undefined),
      });
      await ctx.phase('estimate');
      // Persist the swept work (or clear it when up to date) so the Process button +
      // its cost are visible to the whole workspace across refreshes; the estimate
      // still rides the job's `result`. Completion always toasts (org-wide).
      const { pending, notification } = pendingFromEstimate(
        estimate,
        connector.name,
        new Date().toISOString(),
      );
      await d.integrations.setPending(org, kind, pending);
      return { result: estimate, notification };
    },
    onError: (err) => ({
      level: 'error',
      title: 'Sync failed',
      body: 'The sync didn’t finish. Open Details for the technical reason.',
      data: { detail: err.message },
    }),
  };
}

/** Initial / refresh scan of a connected repo: spec (conflict detection) + the
 *  Code Quality analyze pass — all via runBaseline. */
function repoBaselineJob(
  db: Db,
  onSettled?: (payload: BaselineJobPayload, outcome: JobOutcomeStatus) => Promise<void>,
): JobDefinition<BaselineJobPayload> {
  return {
    type: REPO_BASELINE_TASK,
    title: REPO_BASELINE_TITLE,
    steps: REPO_BASELINE_STEPS,
    org: (p) => p.workspaceOrgId,
    traceMeta: (p) => ({ repoFullName: p.repoFullName, commitSha: p.commitSha }),
    onSettled: onSettled ? (ctx, outcome) => onSettled(ctx.payload, outcome) : undefined,
    sentry: (_err, p) => ({
      component: 'github-gate',
      orgId: p.workspaceOrgId,
      repo: p.repoFullName,
      route: 'worker repo.baseline',
    }),
    async run(ctx) {
      const { repoFullName, installationId, defaultBranch, commitSha, workspaceOrgId, force, quiet } =
        ctx.payload;
      const cfg = loadGithubAppConfig();
      if (!cfg) throw new Error('the GitHub App is not configured');
      const auth = createGithubAuth(cfg);
      const store = selectGateStore(db);
      // Per-workspace toggle: LLM code-analysis rules run only when opted in.
      const enableLlmAnalysis = await new WorkspaceSettingsStore(db).codeAnalysisLlm(workspaceOrgId);
      const req = { repoFullName, installationId, defaultBranch, commitSha, force, enableLlmAnalysis };

      const result = await runBaseline(
        {
          store,
          auth,
          octokitFor: (id) => installationOctokit(cfg, id),
          onPhase: (phase) => ctx.phase(phase),
          specTracker: stepBridge(ctx.tracker, 'spec'),
        },
        req,
      );

      // Quiet runs suppress the SUCCESS toast. The job still tracks (popup) and
      // FAILURES still notify (onError, unconditionally).
      if (quiet) return { result: { repoFullName }, notification: null };
      const notice = baselineNotice(repoFullName, result);
      return {
        result: { repoFullName },
        notification: {
          level: notice.level,
          title: notice.title,
          body: notice.body,
          data: { repoFullName },
        },
      };
    },
    onError: (err, p) => ({
      level: 'error',
      title: `Repository scan failed — ${p.repoFullName}`,
      body: 'The scan didn’t finish. Open Details for the technical reason.',
      data: { repoFullName: p.repoFullName, detail: err.message },
    }),
  };
}

/**
 * Hosted guard-scenario generation for a connected repo: clone the default
 * branch, materialize the Pg-stored curated corpus into the checkout, run the
 * in-process guard generate (LLM via the process-global EE transport;
 * birth-validation via the guard executor seam), and persist the scenario corpus
 * + report to the Pg guard store under the commit. A repo with no curated corpus
 * is a clean success with distinct wording — scenarios generate once the spec is
 * scanned (the onboarding chain re-fires after the next successful baseline).
 */
/** Deps the guard-generate job needs: the shared db (repo-link lookup for the
 *  conflicts email) + the onboarding pipeline + the conflicts-email seam. */
export interface GuardGenerateJobDeps extends ConflictsEmailSeam {
  db: Db;
  pipeline: GuardOnboardingPipeline;
  onSettled?: (
    payload: GuardGenerateJobPayload,
    outcome: JobOutcomeStatus,
    result?: unknown,
  ) => Promise<void>;
}

export function guardGenerateJob(deps: GuardGenerateJobDeps): JobDefinition<GuardGenerateJobPayload> {
  const { pipeline, onSettled } = deps;
  return {
    type: REPO_GUARD_TASK,
    title: REPO_GUARD_TITLE,
    steps: REPO_GUARD_STEPS,
    org: (p) => p.workspaceOrgId,
    traceMeta: (p) => ({ repoFullName: p.repoFullName, commitSha: p.commitSha }),
    // Thread the run result through so the settle chain can suppress a baseline
    // RUN after a BLOCKED generate (it persisted an open-conflicts report, which
    // would otherwise satisfy hasGuardState and chain a run against no scenarios).
    onSettled: onSettled ? (ctx, outcome, result) => onSettled(ctx.payload, outcome, result) : undefined,
    sentry: (_err, p) => ({
      component: 'github-gate',
      orgId: p.workspaceOrgId,
      repo: p.repoFullName,
      route: 'worker repo.guard',
    }),
    async run(ctx) {
      const { repoFullName, installationId, defaultBranch, commitSha } = ctx.payload;
      const cfg = loadGithubAppConfig();
      if (!cfg) throw new Error('the GitHub App is not configured');
      const auth = createGithubAuth(cfg);

      const result = await pipeline.run(
        { auth },
        { repoFullName, installationId, defaultBranch, commitSha },
        {
          onPhase: (phase) => ctx.phase(phase),
          generateTracker: stepBridge(ctx.tracker, 'generate', GUARD_GENERATE_STEPS),
          // ctx.signal = graphile's abortSignal — folded into the pipeline's
          // clone bound so a worker shutdown aborts the git children.
          signal: ctx.signal,
        },
      );

      // Blocked on unresolved spec conflicts: the pipeline persisted a blocked
      // report and saved NO scenarios. Complete (not fail) with a WARNING notice
      // + the gated email, and carry the count so the settle chain suppresses the
      // baseline run. Must precede the noCorpus/scenarios paths (both are false here).
      if (result.openConflicts > 0) {
        await emailConflictsBlocked(deps.db, repoFullName, result.openConflicts, deps, cfg);
        return {
          result: { repoFullName, scenariosWritten: 0, openConflicts: result.openConflicts },
          notification: conflictsBlockedNotification(repoFullName, result.openConflicts),
        };
      }

      if (result.noCorpus) {
        return {
          result: { repoFullName, scenariosWritten: 0, noCorpus: true },
          notification: {
            level: 'success',
            title: 'Guard scenarios — waiting for spec',
            body: `${repoFullName} — no spec corpus yet; guard scenarios will generate once the spec is scanned.`,
            data: { repoFullName, noCorpus: true },
          },
        };
      }
      const n = result.scenariosWritten;
      return {
        result: { repoFullName, scenariosWritten: n, noCorpus: false },
        notification: {
          level: 'success',
          title: 'Guard scenarios generated',
          body: `${repoFullName} — ${n} guard scenario${n === 1 ? '' : 's'} generated.`,
          data: { repoFullName, scenariosWritten: n },
        },
      };
    },
    onError: (err, p) => ({
      level: 'error',
      title: `Guard generation failed — ${p.repoFullName}`,
      body: 'The guard scenarios couldn’t be generated. Open Details for the technical reason.',
      data: { repoFullName: p.repoFullName, detail: err.message },
    }),
  };
}

/** Deps the guard-gate job definition needs: the shared db (gate store) + the
 *  pipeline. `octokitFor` is injectable so tests fake the crash-path Check post;
 *  the default builds an installation client from the app config per invocation. */
export interface GuardGateJobDeps {
  db: Db;
  pipeline: GuardGatePipeline;
  octokitFor?: (installationId: number) => OctokitClient;
}

/**
 * The hosted guard gate for one PR head: run the committed scenario corpus
 * against the checkout through the executor seam (under the process-wide
 * limiter) and complete the guard Check opened at webhook time with the
 * diff-vs-base verdict. The live seams (guard store, executor) are read per
 * invocation so a seam installed after boot is honored. Success is silent —
 * the verdict lives on the PR's Check, and a toast per push would be noise;
 * failures still notify (onError, unconditionally).
 */
export function guardGateJob(deps: GuardGateJobDeps): JobDefinition<GuardGateJobPayload> {
  return {
    type: GUARD_GATE_TASK,
    title: GUARD_GATE_TITLE,
    steps: GUARD_GATE_STEPS,
    org: (p) => p.workspaceOrgId,
    traceMeta: (p) => ({ repoFullName: p.repoFullName, commitSha: p.headSha }),
    sentry: (_err, p) => ({
      component: 'github-gate',
      orgId: p.workspaceOrgId,
      repo: p.repoFullName,
      pr: p.prNumber,
      route: 'worker guard.gate',
    }),
    async run(ctx) {
      const p = ctx.payload;
      const cfg = loadGithubAppConfig();
      if (!cfg) throw new Error('the GitHub App is not configured');
      const octokitFor = deps.octokitFor ?? ((id: number) => installationOctokit(cfg, id));
      const notifier = notifierFromConfig(cfg);
      try {
        const decision = await deps.pipeline.run(
          {
            store: selectGateStore(deps.db),
            guardStore: getGuardStore(),
            auth: createGithubAuth(cfg),
            octokitFor,
            execute: getGuardExecutor(),
            limiter: guardGateLimiter,
            notifier,
            appUrl: process.env.WORKOS_APP_URL ?? 'http://localhost:3000',
          },
          p,
          // ctx.signal = graphile's abortSignal — the pipeline threads it into
          // the executor + git children so a worker shutdown aborts the run.
          { onPhase: (phase) => ctx.phase(phase), signal: ctx.signal },
        );
        return {
          result: {
            repoFullName: p.repoFullName,
            prNumber: p.prNumber,
            headSha: p.headSha,
            conclusion: decision.conclusion,
          },
          notification: null,
        };
      } catch (err) {
        // A crashed gate must never strand the in-progress Check opened at
        // webhook time: settle it as an error-styled FAILURE (a broken gate
        // blocks, never passes silently) before failing the job. Best-effort —
        // the job's own failure (and its notification) is the primary signal.
        await postGuardGateErrorCheck(octokitFor(p.installationId), p).catch(() => undefined);
        throw err;
      }
    },
    onError: (err, p) => ({
      level: 'error',
      title: `Guard gate failed — ${p.repoFullName}`,
      body: 'The guard gate produced no verdict. Open Details for the technical reason.',
      data: { repoFullName: p.repoFullName, prNumber: p.prNumber, detail: err.message },
    }),
  };
}

/** Deps the guard-baseline job needs: the pipeline + the settle hook that replays
 *  the pending guard-baseline buffer. (No db — the body reads the live guard store
 *  seam and the notification rides the shared harness, not a direct store handle.) */
export interface GuardBaselineJobDeps {
  pipeline: GuardBaselinePipeline;
  onSettled?: (
    payload: GuardBaselineJobPayload,
    settled: GuardBaselineSettleOutcome,
  ) => Promise<void>;
}

/**
 * The hosted guard-baseline refresh for one repo: run the committed scenario
 * corpus against the default branch through the executor seam (under the shared
 * gate limiter) and persist the result as the repo's guard baseline. The live
 * seams (guard store, executor) are read per invocation so a seam installed after
 * boot is honored. Success is silent — the baseline is an internal comparison
 * point, not a user-facing verdict, so a toast per merge would be noise; failures
 * still notify (onError, unconditionally). A `no-verdict` (a build/run error left
 * the previous baseline in place) also notifies — the refresh could not settle, so
 * the operator must know main is not yet reflected. `onSettled` replays the repo's
 * coalesced follow-up refresh once the single-flight key frees, keyed on the run's
 * verdict status (see pending-guard-baseline.ts).
 */
export function guardBaselineJob(deps: GuardBaselineJobDeps): JobDefinition<GuardBaselineJobPayload> {
  return {
    type: GUARD_BASELINE_TASK,
    title: GUARD_BASELINE_TITLE,
    steps: GUARD_BASELINE_STEPS,
    org: (p) => p.workspaceOrgId,
    traceMeta: (p) => ({ repoFullName: p.repoFullName, commitSha: p.commitSha }),
    // The run's result (status) rides the harness's onSettled `result` arg so the
    // replay can tell a settled commit from a `no-verdict` one; a thrown run gives
    // no result → status null → the same-commit pending replays.
    onSettled: deps.onSettled
      ? (ctx, outcome, result) =>
          deps.onSettled!(ctx.payload, {
            outcome,
            status: (result as { status?: GuardBaselineResult['status'] } | undefined)?.status ?? null,
          })
      : undefined,
    sentry: (_err, p) => ({
      component: 'github-gate',
      orgId: p.workspaceOrgId,
      repo: p.repoFullName,
      route: 'worker guard.baseline',
    }),
    async run(ctx) {
      const p = ctx.payload;
      const cfg = loadGithubAppConfig();
      if (!cfg) throw new Error('the GitHub App is not configured');
      const result = await deps.pipeline.run(
        {
          guardStore: getGuardStore(),
          auth: createGithubAuth(cfg),
          execute: getGuardExecutor(),
          limiter: guardGateLimiter,
        },
        {
          repoFullName: p.repoFullName,
          installationId: p.installationId,
          workspaceOrgId: p.workspaceOrgId,
          defaultBranch: p.defaultBranch,
          commitSha: p.commitSha,
        },
        { onPhase: (phase) => ctx.phase(phase), signal: ctx.signal },
      );
      const jobResult = {
        repoFullName: p.repoFullName,
        commitSha: p.commitSha,
        status: result.status,
        scenarioCount: result.scenarioCount,
      };
      // `ok`/`no-corpus` are silent (the baseline is an internal comparison point).
      // `no-verdict` means the run could not settle — a build/run error left the
      // previous baseline untouched — so notify failure-style (mirrors onError):
      // the operator must know current main is not yet reflected.
      if (result.status === 'no-verdict') {
        return {
          result: jobResult,
          notification: {
            level: 'error',
            title: `Guard baseline refresh failed — ${p.repoFullName}`,
            body: 'The guard baseline refresh could not settle — a build or run error produced no verdict. The previous baseline remains in effect.',
            data: { repoFullName: p.repoFullName, status: 'no-verdict' },
          },
        };
      }
      return { result: jobResult, notification: null };
    },
    onError: (err, p) => ({
      level: 'error',
      title: `Guard baseline refresh failed — ${p.repoFullName}`,
      body: 'The guard baseline could not be refreshed. Open Details for the technical reason.',
      data: { repoFullName: p.repoFullName, detail: err.message },
    }),
  };
}

/** Deps the guard spec-regen job needs: the shared db + the head-regen pipeline.
 *  `regate` (default = the gate pipeline run inline with the PR's regenerated
 *  corpus injected + `force`) and `octokitFor` (the checkbox-comment updater) are
 *  injectable so tests drive the body without a network or the executor. */
export interface GuardSpecRegenJobDeps extends ConflictsEmailSeam {
  db: Db;
  headRegenPipeline: GuardHeadRegenPipeline;
  regate?: (corpus: GuardGateCorpus, gateReq: GuardGateRunRequest, signal?: AbortSignal) => Promise<void>;
  octokitFor?: (installationId: number) => OctokitClient;
}

/**
 * The spec-change checkbox regen for one PR head: re-scan the head's spec docs,
 * regenerate scenarios, persist them under the head, then re-gate the PR against
 * the PR's OWN regenerated corpus (the auto gate keeps using the baseline corpus —
 * the two are independent). The checkbox comment (opened "running" by the webhook
 * handler) settles to done / nochange / error. A no-doc-universe head is a clean
 * no-op (nochange, no re-gate).
 */
export function guardSpecRegenJob(deps: GuardSpecRegenJobDeps): JobDefinition<GuardSpecRegenJobPayload> {
  const regate =
    deps.regate ??
    (async (corpus: GuardGateCorpus, gateReq: GuardGateRunRequest, signal?: AbortSignal) => {
      const cfg = loadGithubAppConfig();
      if (!cfg) throw new Error('the GitHub App is not configured');
      // The PR's regenerated corpus is injected via loadCorpus; `force` skips the
      // redelivery fast path so a head an earlier auto-gate already ran is re-run.
      await createGuardGatePipeline({ loadCorpus: async () => corpus }).run(
        {
          store: selectGateStore(deps.db),
          guardStore: getGuardStore(),
          auth: createGithubAuth(cfg),
          octokitFor: (id) => installationOctokit(cfg, id),
          execute: getGuardExecutor(),
          limiter: guardGateLimiter,
          notifier: notifierFromConfig(cfg),
          appUrl: process.env.WORKOS_APP_URL ?? 'http://localhost:3000',
        },
        gateReq,
        { force: true, signal },
      );
    });

  return {
    type: GUARD_SPEC_REGEN_TASK,
    title: GUARD_SPEC_REGEN_TITLE,
    steps: GUARD_SPEC_REGEN_STEPS,
    org: (p) => p.workspaceOrgId,
    traceMeta: (p) => ({ repoFullName: p.repoFullName, commitSha: p.headSha }),
    sentry: (_err, p) => ({
      component: 'github-gate',
      orgId: p.workspaceOrgId,
      repo: p.repoFullName,
      pr: p.prNumber,
      route: 'worker guard.spec-regen',
    }),
    async run(ctx) {
      const p = ctx.payload;
      const cfg = loadGithubAppConfig();
      if (!cfg) throw new Error('the GitHub App is not configured');
      const octokitFor = deps.octokitFor ?? ((id: number) => installationOctokit(cfg, id));
      const octokit = octokitFor(p.installationId);
      const coords = splitRepo(p.repoFullName);
      // Settle the checkbox comment — a dashboard-triggered regen (a PR dismissal
      // cleared the last active finding) has none, so a null commentId skips every
      // update. Best-effort either way: the job outcome is authoritative.
      const settleComment = async (body: string): Promise<void> => {
        if (p.commentId == null) return;
        await updateComment(octokit, coords, p.commentId, body).catch(() => undefined);
      };
      try {
        const regen = await deps.headRegenPipeline.run(
          { auth: createGithubAuth(cfg) },
          {
            repoFullName: p.repoFullName,
            installationId: p.installationId,
            prNumber: p.prNumber,
            baseBranch: p.baseBranch,
            headSha: p.headSha,
          },
          {
            onPhase: (phase) => ctx.phase(phase),
            scanTracker: stepBridge(ctx.tracker, 'scan', CURATE_STEPS),
            generateTracker: stepBridge(ctx.tracker, 'generate', GUARD_GENERATE_STEPS),
          },
        );

        // Blocked on the head's own unresolved spec conflicts: the pipeline
        // persisted a blocked report under the head and saved NO scenarios. Settle
        // the checkbox comment to the blocked notice, skip the re-gate, and complete
        // (not fail) with the WARNING + gated email. The writer resolves the
        // conflicts, then re-ticks. Must precede the noCorpus/nochange branch below
        // (blocked has corpus === null).
        if (regen.openConflicts && regen.openConflicts > 0) {
          const n = regen.openConflicts;
          await settleComment(renderGuardSpecComment('blocked', { conflicts: n }));
          await emailConflictsBlocked(deps.db, p.repoFullName, n, deps, cfg);
          return {
            result: { repoFullName: p.repoFullName, prNumber: p.prNumber, openConflicts: n },
            notification: conflictsBlockedNotification(p.repoFullName, n),
          };
        }

        // No doc universe after the head scan → nothing to regenerate or re-gate.
        if (regen.noCorpus || !regen.corpus) {
          await settleComment(renderGuardSpecComment('nochange'));
          return {
            result: { repoFullName: p.repoFullName, prNumber: p.prNumber, noCorpus: true },
            notification: null,
          };
        }

        await ctx.phase('gate');
        const gateReq: GuardGateRunRequest = {
          repoFullName: p.repoFullName,
          installationId: p.installationId,
          workspaceOrgId: p.workspaceOrgId,
          prNumber: p.prNumber,
          defaultBranch: p.defaultBranch,
          baseBranch: p.baseBranch,
          baseSha: p.baseSha,
          headSha: p.headSha,
          headRef: p.headRef,
          isFork: p.isFork,
          checkRunId: null, // no in-progress Check for a comment-triggered re-gate
        };
        await regate(regen.corpus, gateReq, ctx.signal);

        const n = regen.scenariosWritten;
        await settleComment(renderGuardSpecComment('done', { scenariosWritten: n, commitSha: p.headSha }));
        return {
          result: { repoFullName: p.repoFullName, prNumber: p.prNumber, scenariosWritten: n },
          notification: {
            level: 'success',
            title: 'Guard scenarios regenerated',
            body: `${p.repoFullName} — ${n} guard scenario${n === 1 ? '' : 's'} regenerated for PR #${p.prNumber} and re-gated.`,
            data: { repoFullName: p.repoFullName, prNumber: p.prNumber, scenariosWritten: n },
          },
        };
      } catch (err) {
        // Settle the checkbox comment as an error before the job fails (the writer
        // ticked the box — they must see it failed, with a retry). Best-effort.
        await settleComment(renderGuardSpecComment('error', { error: (err as Error).message }));
        throw err;
      }
    },
    onError: (err, p) => ({
      level: 'error',
      title: `Guard regeneration failed — ${p.repoFullName}`,
      body: 'The guard scenarios couldn’t be regenerated. Open Details for the technical reason.',
      data: { repoFullName: p.repoFullName, prNumber: p.prNumber, detail: err.message },
    }),
  };
}

/**
 * Wrap a job definition as a graphile task: resolve the payload → ambient trace
 * context (org / job / repo) the EE transport tags LLM traces with, then run the
 * shared lifecycle. A definition factory (vs a plain definition) is resolved
 * per-invocation. Graphile's per-job `helpers.abortSignal` (fires when the
 * worker shuts down) rides into the body as `ctx.signal` so long work is
 * cancellable.
 */
function registerJob<P extends { jobId: string }>(
  rt: JobRuntime,
  defOrFactory: JobDefinition<P> | ((payload: P) => JobDefinition<P>),
): Task {
  return (rawPayload, helpers) => {
    const payload = rawPayload as P;
    const def = typeof defOrFactory === 'function' ? defOrFactory(payload) : defOrFactory;
    const trace = jobTrace(def.org(payload), payload.jobId, def.traceMeta?.(payload));
    return runWithTrace(trace, () =>
      executeJob(rt, def, payload, { signal: helpers.abortSignal }),
    );
  };
}

/** Deps the exported `runGuardGenerate` test seam needs — the stores + the
 *  onboarding pipeline (faked in tests; `defaultGuardOnboardingPipeline` live).
 *  `signal` stands in for graphile's per-job `helpers.abortSignal`. */
export interface RunGuardGenerateDeps extends ConflictsEmailSeam {
  db: Db;
  jobStore: JobStore;
  notifications: NotificationStore;
  pipeline: GuardOnboardingPipeline;
  signal?: AbortSignal;
}

/**
 * Run the `repo.guard` body directly (unit-testable without graphile-worker). A
 * thin wrapper over the harness so tests keep a stable entry point.
 */
export async function runGuardGenerate(
  deps: RunGuardGenerateDeps,
  payload: GuardGenerateJobPayload,
): Promise<void> {
  await executeJob(
    { db: deps.db, jobStore: deps.jobStore, notifications: deps.notifications },
    guardGenerateJob({
      db: deps.db,
      pipeline: deps.pipeline,
      notifier: deps.notifier,
      appUrl: deps.appUrl,
    }),
    payload,
    { signal: deps.signal },
  );
}

/** Deps the exported `runGuardGate` test seam needs — the stores + the gate
 *  pipeline (faked in tests; `defaultGuardGatePipeline` live). `octokitFor`
 *  fakes the crash-path error-Check post; `signal` stands in for graphile's
 *  per-job `helpers.abortSignal`. */
export interface RunGuardGateDeps {
  db: Db;
  jobStore: JobStore;
  notifications: NotificationStore;
  pipeline: GuardGatePipeline;
  octokitFor?: (installationId: number) => OctokitClient;
  signal?: AbortSignal;
}

/**
 * Run the `guard.gate` body directly (unit-testable without graphile-worker). A
 * thin wrapper over the harness so tests keep a stable entry point.
 */
export async function runGuardGate(
  deps: RunGuardGateDeps,
  payload: GuardGateJobPayload,
): Promise<void> {
  await executeJob(
    { db: deps.db, jobStore: deps.jobStore, notifications: deps.notifications },
    guardGateJob({ db: deps.db, pipeline: deps.pipeline, octokitFor: deps.octokitFor }),
    payload,
    { signal: deps.signal },
  );
}

/** Deps the exported `runGuardBaseline` test seam needs — the stores + the
 *  baseline pipeline (faked in tests; `defaultGuardBaselinePipeline` live).
 *  `onSettled` stands in for the pending-buffer replay; `signal` for graphile's
 *  per-job `helpers.abortSignal`. */
export interface RunGuardBaselineDeps {
  db: Db;
  jobStore: JobStore;
  notifications: NotificationStore;
  pipeline: GuardBaselinePipeline;
  onSettled?: (
    payload: GuardBaselineJobPayload,
    settled: GuardBaselineSettleOutcome,
  ) => Promise<void>;
  signal?: AbortSignal;
}

/**
 * Run the `guard.baseline` body directly (unit-testable without graphile-worker).
 * A thin wrapper over the harness so tests keep a stable entry point.
 */
export async function runGuardBaseline(
  deps: RunGuardBaselineDeps,
  payload: GuardBaselineJobPayload,
): Promise<void> {
  await executeJob(
    { db: deps.db, jobStore: deps.jobStore, notifications: deps.notifications },
    guardBaselineJob({ pipeline: deps.pipeline, onSettled: deps.onSettled }),
    payload,
    { signal: deps.signal },
  );
}

/** Deps the exported `runGuardSpecRegen` test seam needs — the stores + the
 *  head-regen pipeline (faked in tests) + the injectable re-gate / comment updater. */
export interface RunGuardSpecRegenDeps extends ConflictsEmailSeam {
  db: Db;
  jobStore: JobStore;
  notifications: NotificationStore;
  headRegenPipeline: GuardHeadRegenPipeline;
  regate?: (corpus: GuardGateCorpus, gateReq: GuardGateRunRequest, signal?: AbortSignal) => Promise<void>;
  octokitFor?: (installationId: number) => OctokitClient;
  signal?: AbortSignal;
}

/**
 * Run the `guard.spec-regen` body directly (unit-testable without graphile-worker).
 * A thin wrapper over the harness so tests keep a stable entry point.
 */
export async function runGuardSpecRegen(
  deps: RunGuardSpecRegenDeps,
  payload: GuardSpecRegenJobPayload,
): Promise<void> {
  await executeJob(
    { db: deps.db, jobStore: deps.jobStore, notifications: deps.notifications },
    guardSpecRegenJob({
      db: deps.db,
      headRegenPipeline: deps.headRegenPipeline,
      regate: deps.regate,
      octokitFor: deps.octokitFor,
      notifier: deps.notifier,
      appUrl: deps.appUrl,
    }),
    payload,
    { signal: deps.signal },
  );
}

/** Deps the exported `runKnowledgeEstimate` / `runKnowledgeSync` test seams need —
 *  the job-body deps plus the harness stores. */
export interface RunKnowledgeDeps {
  db: Db;
  jobStore: JobStore;
  notifications: NotificationStore;
  integrations: IntegrationStore;
  knowledge: PgKnowledgeStore;
}

/** Run the `knowledge.estimate` (sweep) body directly (unit-testable without
 *  graphile-worker). A thin wrapper over the harness, mirroring `runGuardGate`. */
export async function runKnowledgeEstimate(
  deps: RunKnowledgeDeps,
  payload: EstimateJobPayload,
): Promise<void> {
  await executeJob(
    { db: deps.db, jobStore: deps.jobStore, notifications: deps.notifications },
    knowledgeEstimateJob(deps),
    payload,
  );
}

/** Run the `knowledge.sync` (processing) body directly. A thin wrapper over the
 *  harness, mirroring `runGuardGate`. `onSettled` stands in for the workspace guard
 *  chain (see knowledge-chain.ts), so a test can assert it fires on the outcome. */
export async function runKnowledgeSync(
  deps: RunKnowledgeDeps,
  payload: SyncJobPayload,
  onSettled?: (payload: SyncJobPayload, outcome: JobOutcomeStatus) => Promise<void>,
): Promise<void> {
  await executeJob(
    { db: deps.db, jobStore: deps.jobStore, notifications: deps.notifications },
    knowledgeSyncJob(deps, onSettled),
    payload,
  );
}

export async function startWorker(deps: StartWorkerDeps): Promise<Runner> {
  const { db, jobStore } = deps;
  const notifications = new NotificationStore(db);
  const rt: JobRuntime = { db, jobStore, notifications };
  const bodyDeps: JobBodyDeps = {
    db,
    integrations: new IntegrationStore(db, deps.masterSecret),
    knowledge: new PgKnowledgeStore(db),
  };

  const runner = await run({
    connectionString: deps.connectionString,
    concurrency: 2,
    // ee-server owns SIGTERM/SIGINT (sentry flush + runner.stop in registerJobs).
    noHandleSignals: true,
    taskList: {
      [KNOWLEDGE_SYNC_TASK]: registerJob(rt, knowledgeSyncJob(bodyDeps, deps.onKnowledgeSyncSettled)),
      [KNOWLEDGE_ESTIMATE_TASK]: registerJob(rt, knowledgeEstimateJob(bodyDeps)),
      [REPO_BASELINE_TASK]: registerJob(rt, repoBaselineJob(db, deps.onBaselineSettled)),
      [REPO_GUARD_TASK]: registerJob(
        rt,
        guardGenerateJob({
          db,
          pipeline: defaultGuardOnboardingPipeline,
          onSettled: deps.onGuardGenerateSettled,
        }),
      ),
      // Factory form: the job body reads the live guard store/executor seams per
      // invocation (github-app / OSS setup may install them after the worker starts).
      [GUARD_GATE_TASK]: registerJob(rt, () =>
        guardGateJob({ db, pipeline: defaultGuardGatePipeline }),
      ),
      // Guard baseline refresh — factory form (live seams per invocation). onSettled
      // replays the repo's coalesced follow-up refresh once the key frees.
      [GUARD_BASELINE_TASK]: registerJob(rt, () =>
        guardBaselineJob({
          pipeline: defaultGuardBaselinePipeline,
          onSettled: deps.onGuardBaselineSettled,
        }),
      ),
      // The spec-change checkbox regen: re-scan the head, regenerate scenarios,
      // and re-gate against the PR's own corpus (the default regate seam).
      [GUARD_SPEC_REGEN_TASK]: registerJob(rt, () =>
        guardSpecRegenJob({ db, headRegenPipeline: defaultGuardHeadRegenPipeline }),
      ),
    },
  });
  log.info('[ee-jobs] worker runner started');
  return runner;
}
