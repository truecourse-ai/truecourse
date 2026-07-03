/**
 * The in-process graphile-worker runner + the four background job definitions.
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
import { and, eq } from 'drizzle-orm';
import { workspaceContractSets, type EeDb } from '@truecourse/ee-db';
import { JobStore, NotificationStore, PgKnowledgeStore, WorkspaceSettingsStore } from '@truecourse/ee-data-store';
import { runWithTrace, type TraceContext } from '@truecourse/ee-llm';
import { log } from '@truecourse/core/lib/logger';
import {
  runBaseline,
  loadGithubAppConfig,
  createGithubAuth,
  installationOctokit,
  selectGateStore,
  getPrRegater,
  type BaselineResult,
  type PrRegater,
} from '@truecourse/ee-github-app';
import type { NotificationLevel } from '@truecourse/shared';
import { upstreamStatusOf } from '../observability/sentry.js';
import { IntegrationStore } from '../integrations/store.js';
import { CONNECTORS } from '../knowledge/connectors/registry.js';
import { connectorConfig, type ConnectorKind } from '../knowledge/connectors/types.js';
import { syncWorkspaceKnowledge, SYNC_MSG_CONSOLIDATE } from '../knowledge/sync.js';
import { CURATE_STEPS, CORPUS_GENERATE_STEPS, VERIFY_STEPS } from '@truecourse/core/commands/spec-in-process';
import { StepTracker, type AnalysisProgressPayload } from '@truecourse/core/progress';
import { JobStepTracker } from './steps.js';
import { executeJob, type JobDefinition, type JobRuntime } from './harness.js';
import {
  KNOWLEDGE_SYNC_TASK,
  KNOWLEDGE_SYNC_TITLE,
  KNOWLEDGE_SYNC_STEPS,
  REPO_BASELINE_TASK,
  REPO_BASELINE_TITLE,
  REPO_BASELINE_STEPS,
  WORKSPACE_CONTRACTS_TASK,
  WORKSPACE_CONTRACTS_TITLE,
  WORKSPACE_CONTRACTS_STEPS,
  PR_REGATE_TASK,
  PR_REGATE_TITLE,
  PR_REGATE_STEPS,
  type SyncJobPayload,
  type BaselineJobPayload,
  type WorkspaceContractsJobPayload,
  type PrRegateJobPayload,
} from './constants.js';

/**
 * Bridge an OSS in-process StepTracker onto one EE job step: each inner-phase
 * transition is forwarded as the EE step's inline detail, so the popup shows the
 * same numbered sub-phases the OSS popup does. `stepDefs` is the inner phase set
 * to mirror — CURATE_STEPS (scan) by default, CORPUS_GENERATE_STEPS (generate),
 * VERIFY_STEPS (drift), or a union. Returns a StepTracker to hand to the callee.
 */
function specScanBridge(
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
  db: EeDb;
  connectionString: string;
  masterSecret: string;
  jobStore: JobStore;
  /**
   * Called when a workspace's contracts actually CHANGED (KB sync / workspace
   * decision), to re-verify every connected repo against the new effective
   * contracts. Returns the number of repos re-verified (for the sync notice).
   */
  onWorkspaceContractsChanged?: (workspaceOrgId: string) => Promise<number>;
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
 * produced. Open conflicts mean contracts were NOT generated (the gate skips
 * generation until the spec is fully resolved), so we must not claim they're
 * ready — instead point the user at the conflicts to resolve.
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
      body: `${repoFullName} — spec is ready, but ${n} open conflict${n === 1 ? '' : 's'} must be resolved before contracts and the gate baseline are generated.`,
    };
  }
  if (!result.hasContracts) {
    return {
      level: 'success',
      title: 'Repository scan complete',
      body: `${repoFullName} — spec is ready (no contracts generated — no spec docs found).`,
    };
  }
  return {
    level: 'success',
    title: 'Repository scan complete',
    body: `${repoFullName} — spec, contracts & gate baseline are ready.`,
  };
}

/**
 * Plain-language body for a contract-generation failure. The raw technical reason
 * is kept separately in `data.detail` (shown under "Details" in the feed) — we
 * never dump it into the headline. Recognizes the common resolver-hard error.
 */
function contractFailureBody(message: string): string {
  return /failed to resolve/i.test(message)
    ? 'The contracts couldn’t be built — the resolved spec has conflicting or duplicate definitions. Re-resolve the conflict in Spec, then try again.'
    : 'The contracts couldn’t be generated. Open Details for the technical reason.';
}

/** Shared deps the workspace-touching job bodies close over (built in startWorker). */
interface JobBodyDeps {
  db: EeDb;
  integrations: IntegrationStore;
  knowledge: PgKnowledgeStore;
  wsContractsHash: (org: string) => Promise<string | null>;
  reverifyReposIfWorkspaceChanged: (org: string, beforeHash: string | null) => Promise<number>;
}

// --- Job definitions -------------------------------------------------

/** Connector sync: fetch docs → consolidate spec & contracts, then re-verify repos
 *  if the workspace contracts changed. */
function knowledgeSyncJob(d: JobBodyDeps): JobDefinition<SyncJobPayload> {
  return {
    type: KNOWLEDGE_SYNC_TASK,
    title: KNOWLEDGE_SYNC_TITLE,
    steps: KNOWLEDGE_SYNC_STEPS,
    org: (p) => p.org,
    sentry: (err, p) => ({
      component: 'knowledge',
      orgId: p.org,
      connector: p.kind,
      upstreamStatus: upstreamStatusOf(err),
      route: 'worker knowledge.sync',
    }),
    async run(ctx) {
      const { org, kind } = ctx.payload;
      const connector = CONNECTORS[kind as ConnectorKind];
      if (!connector) throw new Error(`Unknown connector: ${kind}`);
      const conn = await d.integrations.getConnection(org, kind);
      if (!conn?.token) throw new Error(`No ${kind} connection.`);
      const cfg = connectorConfig(connector, conn.config, conn.token);

      const beforeHash = await d.wsContractsHash(org);
      const result = await syncWorkspaceKnowledge(org, d.knowledge, connector, cfg, {
        onProgress: async (current, total, message) => {
          if (message === SYNC_MSG_CONSOLIDATE) await ctx.phase('consolidate');
          else await ctx.phase('fetch', total > 0 ? `${current}/${total} docs` : undefined);
        },
        // Curate sub-phases + contract generation both surface on the "consolidate"
        // step (the bridge mirrors both step sets, so it shows N/M docs then the
        // per-area contract counts).
        tracker: specScanBridge(ctx.tracker, 'consolidate', [...CURATE_STEPS, ...CORPUS_GENERATE_STEPS]),
      });

      const reverified = await d.reverifyReposIfWorkspaceChanged(org, beforeHash);
      return {
        result: { synced: result.synced },
        notification: {
          level: 'success',
          title: 'Knowledge sync complete',
          body: `Synced ${result.synced} document${result.synced === 1 ? '' : 's'}.${
            reverified > 0
              ? ` Re-verifying ${reverified} repo${reverified === 1 ? '' : 's'} against the updated contracts.`
              : ''
          }`,
          data: { synced: result.synced, reverified },
        },
      };
    },
    onError: (err) => ({
      level: 'error',
      title: 'Knowledge sync failed',
      body: 'The sync didn’t finish. Open Details for the technical reason.',
      data: { detail: err.message },
    }),
  };
}

/** Initial / refresh scan of a connected repo: spec + contracts, the gate drift
 *  baseline, AND the Code Quality analyze pass — all via runBaseline. */
function repoBaselineJob(db: EeDb): JobDefinition<BaselineJobPayload> {
  return {
    type: REPO_BASELINE_TASK,
    title: REPO_BASELINE_TITLE,
    steps: REPO_BASELINE_STEPS,
    org: (p) => p.workspaceOrgId,
    traceMeta: (p) => ({ repoFullName: p.repoFullName, commitSha: p.commitSha }),
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
          specTracker: specScanBridge(ctx.tracker, 'spec'),
          generateTracker: specScanBridge(ctx.tracker, 'contracts', CORPUS_GENERATE_STEPS),
          driftTracker: specScanBridge(ctx.tracker, 'drift', VERIFY_STEPS),
        },
        req,
      );

      // Quiet runs (the workspace→repos ripple) suppress the SUCCESS toast — one KB
      // sync re-verifying N repos shouldn't fan out N notifications. The job still
      // tracks (popup) and FAILURES still notify (onError, unconditionally).
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

/** Refresh the workspace `.tc` corpus after a Knowledge decision, then re-verify
 *  repos if the workspace contracts changed. */
function workspaceContractsJob(
  reverifyReposIfWorkspaceChanged: (org: string, beforeHash: string | null) => Promise<number>,
): JobDefinition<WorkspaceContractsJobPayload> {
  return {
    type: WORKSPACE_CONTRACTS_TASK,
    title: WORKSPACE_CONTRACTS_TITLE,
    steps: WORKSPACE_CONTRACTS_STEPS,
    org: (p) => p.workspaceOrgId,
    sentry: (_err, p) => ({
      component: 'knowledge',
      orgId: p.workspaceOrgId,
      route: 'worker workspace.contracts',
    }),
    async run(ctx) {
      await ctx.phase('contracts');
      const reverified = await reverifyReposIfWorkspaceChanged(ctx.payload.workspaceOrgId, null);
      return {
        result: {},
        notification: {
          level: 'success',
          title: 'Workspace contracts refreshed',
          body: `Knowledge contracts are regenerated on sync.${
            reverified > 0 ? ` Re-verifying ${reverified} repo${reverified === 1 ? '' : 's'}.` : ''
          }`,
          data: { reverified },
        },
      };
    },
    onError: (err) => ({
      level: 'error',
      title: 'Contract generation failed — Workspace Knowledge',
      body: contractFailureBody(err.message),
      data: { detail: err.message },
    }),
  };
}

/**
 * Re-gate one PR after a PR-scoped decision cleared its last conflict. The
 * `regate` seam streams the gate's coarse phases (spec → contracts → verify →
 * verdict) onto the popup. A null regater means the GitHub App isn't configured;
 * that's a terminal failure (same shape as baseline's missing-config throw).
 */
export function prRegateJob(regate: PrRegater | null): JobDefinition<PrRegateJobPayload> {
  return {
    type: PR_REGATE_TASK,
    title: PR_REGATE_TITLE,
    steps: PR_REGATE_STEPS,
    org: (p) => p.workspaceOrgId,
    traceMeta: (p) => ({ repoFullName: p.repoFullName }),
    sentry: (_err, p) => ({
      component: 'github-gate',
      orgId: p.workspaceOrgId,
      repo: p.repoFullName,
      pr: p.prNumber,
      route: 'worker pr.regate',
    }),
    async run(ctx) {
      const { repoFullName, prNumber } = ctx.payload;
      if (!regate) throw new Error('the GitHub App is not configured');
      await regate(repoFullName, prNumber, (phase) => ctx.phase(phase));
      return {
        result: { repoFullName, prNumber },
        notification: {
          level: 'success',
          title: 'PR re-gated',
          body: `${repoFullName} — PR #${prNumber} re-gated after conflict resolution.`,
          data: { repoFullName, prNumber },
        },
      };
    },
    onError: (err, p) => ({
      level: 'error',
      title: `PR re-gate failed — ${p.repoFullName}`,
      body: 'The re-gate didn’t finish. Open Details for the technical reason.',
      data: { repoFullName: p.repoFullName, prNumber: p.prNumber, detail: err.message },
    }),
  };
}

/**
 * Wrap a job definition as a graphile task: resolve the payload → ambient trace
 * context (org / job / repo) the EE transport tags LLM traces with, then run the
 * shared lifecycle. A definition factory (vs a plain definition) is resolved
 * per-invocation, so pr.regate reads the current `getPrRegater()` seam each run.
 */
function registerJob<P extends { jobId: string }>(
  rt: JobRuntime,
  defOrFactory: JobDefinition<P> | ((payload: P) => JobDefinition<P>),
): Task {
  return (rawPayload) => {
    const payload = rawPayload as P;
    const def = typeof defOrFactory === 'function' ? defOrFactory(payload) : defOrFactory;
    const trace = jobTrace(def.org(payload), payload.jobId, def.traceMeta?.(payload));
    return runWithTrace(trace, () => executeJob(rt, def, payload));
  };
}

/** Deps the exported `runPrRegate` test seam needs — the stores + the github-app
 *  re-gate seam (null when the App isn't configured). */
export interface RunPrRegateDeps {
  db: EeDb;
  jobStore: JobStore;
  notifications: NotificationStore;
  regate: PrRegater | null;
}

/**
 * Run the `pr.regate` body directly (unit-testable without graphile-worker). A
 * thin wrapper over the harness so tests keep a stable entry point.
 */
export async function runPrRegate(deps: RunPrRegateDeps, payload: PrRegateJobPayload): Promise<void> {
  await executeJob(
    { db: deps.db, jobStore: deps.jobStore, notifications: deps.notifications },
    prRegateJob(deps.regate),
    payload,
  );
}

export async function startWorker(deps: StartWorkerDeps): Promise<Runner> {
  const { db, jobStore } = deps;
  const notifications = new NotificationStore(db);
  const knowledge = new PgKnowledgeStore(db);
  const integrations = new IntegrationStore(db, deps.masterSecret);
  const rt: JobRuntime = { db, jobStore, notifications };

  // Fingerprint of a workspace's contract corpus — lets us detect whether a KB
  // sync / workspace decision actually CHANGED the contracts (so we only re-verify
  // repos when there's something new). Null = no workspace contracts stored.
  const wsContractsHash = async (org: string): Promise<string | null> => {
    const [row] = await db
      .select({ h: workspaceContractSets.manifestHash })
      .from(workspaceContractSets)
      .where(and(eq(workspaceContractSets.workspaceOrgId, org), eq(workspaceContractSets.kind, 'contracts')))
      .limit(1);
    return row?.h ?? null;
  };

  // If the workspace contracts changed since `beforeHash`, re-verify every repo in
  // the workspace against the new effective set. Returns the count re-verified
  // (0 when unchanged). Best-effort — never throws into the calling job.
  const reverifyReposIfWorkspaceChanged = async (
    org: string,
    beforeHash: string | null,
  ): Promise<number> => {
    try {
      const afterHash = await wsContractsHash(org);
      if (afterHash === beforeHash) return 0;
      return (await deps.onWorkspaceContractsChanged?.(org)) ?? 0;
    } catch (err) {
      log.warn(`[ee-jobs] workspace→repos re-verify failed for ${org}: ${(err as Error).message}`);
      return 0;
    }
  };

  const bodyDeps: JobBodyDeps = {
    db,
    integrations,
    knowledge,
    wsContractsHash,
    reverifyReposIfWorkspaceChanged,
  };

  const runner = await run({
    connectionString: deps.connectionString,
    concurrency: 2,
    // ee-server owns SIGTERM/SIGINT (sentry flush + runner.stop in registerJobs).
    noHandleSignals: true,
    taskList: {
      [KNOWLEDGE_SYNC_TASK]: registerJob(rt, knowledgeSyncJob(bodyDeps)),
      [REPO_BASELINE_TASK]: registerJob(rt, repoBaselineJob(db)),
      [WORKSPACE_CONTRACTS_TASK]: registerJob(rt, workspaceContractsJob(reverifyReposIfWorkspaceChanged)),
      // Factory form: read the current re-gate seam per invocation (github-app may
      // set it after the worker starts).
      [PR_REGATE_TASK]: registerJob(rt, () => prRegateJob(getPrRegater())),
    },
  });
  log.info('[ee-jobs] worker runner started');
  return runner;
}
