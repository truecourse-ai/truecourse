/**
 * The in-process graphile-worker runner + the `knowledge.sync` task.
 *
 * `run()` installs graphile-worker's own schema and starts polling/LISTENing for
 * jobs. The `knowledge.sync` task IS the old inline `/sync` body, now off the
 * request path: it marks the `jobs` row running, drives the connector sync with
 * an `onProgress` callback (→ `jobs.progress` + a live SSE event), and on terminal
 * records a durable `notifications` row + SSE. Single-flight is already guaranteed
 * by the create-time partial-unique index, so the task needs no extra lock.
 *
 * Jobs are enqueued with `maxAttempts: 1` (see the /sync route): a sync failure
 * is terminal and surfaced to the user, who can re-run (idempotent; unchanged
 * pages cost 0 LLM). So a thrown task = a permanent fail, never a silent retry
 * that would double-run and fight the single-flight key.
 */

import { run, type Runner, type Task } from 'graphile-worker';
import type { EeDb } from '@truecourse/ee-db';
import { JobStore, NotificationStore, PgKnowledgeStore } from '@truecourse/ee-data-store';
import { runWithTrace, type TraceContext } from '@truecourse/ee-llm';
import { log } from '@truecourse/core/lib/logger';
import {
  runBaseline,
  loadGithubAppConfig,
  createGithubAuth,
  selectGateStore,
  type BaselineResult,
} from '@truecourse/ee-github-app';
import type { NotificationLevel } from '@truecourse/shared';
import { captureEeException, upstreamStatusOf } from '../observability/sentry.js';
import { IntegrationStore } from '../integrations/store.js';
import { CONNECTORS } from '../knowledge/connectors/registry.js';
import { connectorConfig, type ConnectorKind } from '../knowledge/connectors/types.js';
import { syncWorkspaceKnowledge, SYNC_MSG_CONSOLIDATE } from '../knowledge/sync.js';
import {
  regenerateRepoContractsFromDecisions,
  generateWorkspaceContractsInProcess,
  SCAN_STEPS,
} from '@truecourse/core/commands/spec-in-process';
import { StepTracker, type AnalysisProgressPayload } from '@truecourse/core/progress';
import { publishEvent } from './events.js';
import { JobStepTracker, type StepEmit } from './steps.js';

/**
 * Bridge an OSS spec-scan StepTracker onto one EE job step: each SCAN_STEPS
 * transition (discover docs / extract blocks / resolve conflicts) is forwarded as
 * the EE step's inline detail, so the popup shows the same numbered sub-phases the
 * OSS popup does. Returns a StepTracker to hand to the spec scan.
 */
function specScanBridge(eeTracker: JobStepTracker, stepKey: string): StepTracker {
  return new StepTracker((p: AnalysisProgressPayload) => {
    const text = p.detail ? `${p.step} · ${p.detail}` : p.step;
    void eeTracker.detail(stepKey, text);
  }, [...SCAN_STEPS]);
}
import {
  KNOWLEDGE_SYNC_TASK,
  REPO_BASELINE_TASK,
  REPO_CONTRACTS_TASK,
  WORKSPACE_CONTRACTS_TASK,
  type SyncJobPayload,
  type BaselineJobPayload,
  type ContractsJobPayload,
  type WorkspaceContractsJobPayload,
} from './constants.js';

export interface StartWorkerDeps {
  db: EeDb;
  connectionString: string;
  masterSecret: string;
  jobStore: JobStore;
  /**
   * Called after `repo.contracts` regenerates a repo's contracts, to chain a
   * baseline refresh (the only path with a clone) so verify runs against the new
   * contracts and the drift baseline is recomputed. Best-effort; a failure here
   * never flips the (already-succeeded) contracts job.
   */
  onContractsRegenerated?: (repoKey: string, workspaceOrgId: string) => Promise<void>;
}

/**
 * Wrap a worker task so every LLM call it makes runs inside an ambient trace
 * context (org / job / repo) the EE transport's recorder tags traces with. The
 * task bodies are unchanged — only the payload→context mapping lives here.
 */
function withTrace<P>(ctxOf: (payload: P) => TraceContext, task: Task): Task {
  return (payload, helpers) =>
    runWithTrace(ctxOf(payload as P), async () => {
      await task(payload, helpers);
    });
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

export async function startWorker(deps: StartWorkerDeps): Promise<Runner> {
  const { db, jobStore } = deps;
  const notifications = new NotificationStore(db);
  const knowledge = new PgKnowledgeStore(db);
  const integrations = new IntegrationStore(db, deps.masterSecret);

  // A StepTracker emit that persists coarse progress (current/total/message) on
  // the jobs row and forwards the full stepped checklist on the LIVE SSE event —
  // steps ride the event only, never the row (see JobProgress.steps).
  const stepEmit = (jobId: string, org: string): StepEmit => async (snap) => {
    const job = await jobStore.setProgress(jobId, {
      current: snap.current,
      total: snap.total,
      message: snap.message,
    });
    if (job) {
      await publishEvent(db, org, {
        type: 'job.progress',
        job: { ...job, progress: { ...job.progress, steps: snap.steps } },
      });
    }
  };

  const knowledgeSync: Task = async (rawPayload) => {
    const { jobId, org, kind } = rawPayload as SyncJobPayload;

    const running = await jobStore.markRunning(jobId);
    if (running) await publishEvent(db, org, { type: 'job.progress', job: running });

    try {
      const connector = CONNECTORS[kind as ConnectorKind];
      if (!connector) throw new Error(`Unknown connector: ${kind}`);
      const conn = await integrations.getConnection(org, kind);
      if (!conn?.token) throw new Error(`No ${kind} connection.`);
      const cfg = connectorConfig(connector, conn.config, conn.token);

      const tracker = new JobStepTracker(
        [
          { key: 'fetch', label: 'Fetching documents' },
          { key: 'consolidate', label: 'Consolidating spec & contracts' },
        ],
        stepEmit(jobId, org),
      );
      const result = await syncWorkspaceKnowledge(org, knowledge, connector, cfg, {
        onProgress: async (current, total, message) => {
          if (message === SYNC_MSG_CONSOLIDATE) await tracker.advance('consolidate');
          else await tracker.advance('fetch', total > 0 ? `${current}/${total} docs` : undefined);
        },
        // Spec sub-phases + contract slices both surface on the "consolidate" step.
        tracker: specScanBridge(tracker, 'consolidate'),
        onSliceProgress: (done, total) =>
          void tracker.detail('consolidate', `${done}/${total} slices`),
        onRepairProgress: (done, total) =>
          void tracker.detail('consolidate', `repairing ${done}/${total}`),
      });

      const done = await jobStore.markSucceeded(jobId, { synced: result.synced });
      const note = await notifications.add({
        org,
        kind: KNOWLEDGE_SYNC_TASK,
        level: 'success',
        title: 'Knowledge sync complete',
        body: `Synced ${result.synced} document${result.synced === 1 ? '' : 's'}.`,
        data: { jobId, synced: result.synced },
      });
      // Terminal job state first (clears the client's activeJobs), then the toast.
      if (done) await publishEvent(db, org, { type: 'job.progress', job: done });
      await publishEvent(db, org, { type: 'notification', notification: note, jobId });
    } catch (err) {
      const message = (err as Error).message;
      const failed = await jobStore.markFailed(jobId, message);
      const note = await notifications.add({
        org,
        kind: KNOWLEDGE_SYNC_TASK,
        level: 'error',
        title: 'Knowledge sync failed',
        body: 'The sync didn’t finish. Open Details for the technical reason.',
        data: { jobId, detail: message },
      });
      if (failed) await publishEvent(db, org, { type: 'job.progress', job: failed });
      await publishEvent(db, org, { type: 'notification', notification: note, jobId });
      captureEeException(err, {
        component: 'knowledge',
        orgId: org,
        connector: kind,
        upstreamStatus: upstreamStatusOf(err),
        route: 'worker knowledge.sync',
      });
      throw err; // maxAttempts:1 ⇒ permanent fail (no retry), and graphile records it as failed.
    }
  };

  // Initial / refresh scan of a connected repo: generate its spec + contracts and
  // the gate drift baseline (runBaseline). Triggered on connect AND on
  // default-branch push, off the request path. EE is gate + Knowledge only — it
  // does NOT run the OSS code-analysis pass (graph/violations). The gate store +
  // GitHub auth are rebuilt from db + env config (cheap).
  const repoBaseline: Task = async (rawPayload) => {
    const { jobId, repoFullName, installationId, defaultBranch, commitSha, workspaceOrgId, force } =
      rawPayload as BaselineJobPayload;

    const running = await jobStore.markRunning(jobId);
    if (running) await publishEvent(db, workspaceOrgId, { type: 'job.progress', job: running });

    const tracker = new JobStepTracker(
      [
        { key: 'clone', label: 'Cloning repository' },
        { key: 'spec', label: 'Extracting spec' },
        { key: 'contracts', label: 'Generating contracts' },
        { key: 'drift', label: 'Computing drift baseline' },
      ],
      stepEmit(jobId, workspaceOrgId),
    );

    try {
      const cfg = loadGithubAppConfig();
      if (!cfg) throw new Error('the GitHub App is not configured');
      const auth = createGithubAuth(cfg);
      const store = selectGateStore(db);
      const req = { repoFullName, installationId, defaultBranch, commitSha, force };

      const result = await runBaseline(
        {
          store,
          auth,
          onPhase: (phase) => tracker.advance(phase),
          specTracker: specScanBridge(tracker, 'spec'),
          onSliceProgress: (done, total) =>
            void tracker.detail('contracts', `${done}/${total} slices`),
          onRepairProgress: (done, total) =>
            void tracker.detail('contracts', `repairing ${done}/${total}`),
        },
        req,
      );

      const done = await jobStore.markSucceeded(jobId, { repoFullName });
      const notice = baselineNotice(repoFullName, result);
      const note = await notifications.add({
        org: workspaceOrgId,
        kind: REPO_BASELINE_TASK,
        level: notice.level,
        title: notice.title,
        body: notice.body,
        data: { jobId, repoFullName },
      });
      if (done) await publishEvent(db, workspaceOrgId, { type: 'job.progress', job: done });
      await publishEvent(db, workspaceOrgId, { type: 'notification', notification: note, jobId });
    } catch (err) {
      const message = (err as Error).message;
      const failed = await jobStore.markFailed(jobId, message);
      const note = await notifications.add({
        org: workspaceOrgId,
        kind: REPO_BASELINE_TASK,
        level: 'error',
        title: `Repository scan failed — ${repoFullName}`,
        body: 'The scan didn’t finish. Open Details for the technical reason.',
        data: { jobId, repoFullName, detail: message },
      });
      if (failed) await publishEvent(db, workspaceOrgId, { type: 'job.progress', job: failed });
      await publishEvent(db, workspaceOrgId, { type: 'notification', notification: note, jobId });
      captureEeException(err, {
        component: 'github-gate',
        orgId: workspaceOrgId,
        repo: repoFullName,
        route: 'worker repo.baseline',
      });
      throw err; // maxAttempts:1 ⇒ permanent fail.
    }
  };

  // Debounced contract refresh after a decision, off the request path. Tracked: a
  // jobs row + a stepped progress popup (the single-flight key coalesces a burst of
  // decisions onto one row). Notifies on BOTH outcomes — every user-triggered
  // background op confirms itself (success or failure). The job reads the latest
  // persisted decisions when it runs (final state wins).
  const repoContracts: Task = async (rawPayload) => {
    const { jobId, repoKey, workspaceOrgId } = rawPayload as ContractsJobPayload;

    const running = await jobStore.markRunning(jobId);
    if (running) await publishEvent(db, workspaceOrgId, { type: 'job.progress', job: running });

    const tracker = new JobStepTracker(
      [
        { key: 'spec', label: 'Re-merging spec' },
        { key: 'contracts', label: 'Generating contracts' },
      ],
      stepEmit(jobId, workspaceOrgId),
    );

    try {
      await regenerateRepoContractsFromDecisions(repoKey, {
        onPhase: (phase) => tracker.advance(phase),
        onSliceProgress: (done, total) =>
          void tracker.detail('contracts', `${done}/${total} slices`),
        onRepairProgress: (done, total) =>
          void tracker.detail('contracts', `repairing ${done}/${total}`),
      });
      const done = await jobStore.markSucceeded(jobId, { repoKey });
      const note = await notifications.add({
        org: workspaceOrgId,
        kind: REPO_CONTRACTS_TASK,
        level: 'success',
        title: 'Contracts updated',
        body: `${repoKey} — contracts regenerated from your resolved spec.`,
        data: { jobId, repoKey },
      });
      if (done) await publishEvent(db, workspaceOrgId, { type: 'job.progress', job: done });
      await publishEvent(db, workspaceOrgId, { type: 'notification', notification: note, jobId });
      // Chain a drift-baseline refresh so verify runs against the freshly
      // generated contracts (best-effort — never flips this succeeded job).
      try {
        await deps.onContractsRegenerated?.(repoKey, workspaceOrgId);
      } catch (chainErr) {
        log.warn(
          `[ee-jobs] post-contracts baseline chain failed for ${repoKey}: ${(chainErr as Error).message}`,
        );
      }
    } catch (err) {
      const message = (err as Error).message;
      const failed = await jobStore.markFailed(jobId, message);
      const note = await notifications.add({
        org: workspaceOrgId,
        kind: REPO_CONTRACTS_TASK,
        level: 'error',
        title: `Contract generation failed — ${repoKey}`,
        body: contractFailureBody(message),
        data: { jobId, repoKey, detail: message },
      });
      if (failed) await publishEvent(db, workspaceOrgId, { type: 'job.progress', job: failed });
      await publishEvent(db, workspaceOrgId, { type: 'notification', notification: note, jobId });
      captureEeException(err, {
        component: 'github-gate',
        orgId: workspaceOrgId,
        repo: repoKey,
        route: 'worker repo.contracts',
      });
      throw err;
    }
  };

  // The workspace analogue of repo.contracts: refresh the workspace `.tc` corpus
  // after a Knowledge decision (the spec re-merge already ran synchronously, so the
  // job is generate-only — one step). Same tracked model; notifies on success + failure.
  const workspaceContracts: Task = async (rawPayload) => {
    const { jobId, workspaceOrgId } = rawPayload as WorkspaceContractsJobPayload;

    const running = await jobStore.markRunning(jobId);
    if (running) await publishEvent(db, workspaceOrgId, { type: 'job.progress', job: running });

    const tracker = new JobStepTracker(
      [{ key: 'contracts', label: 'Generating contracts' }],
      stepEmit(jobId, workspaceOrgId),
    );

    try {
      await tracker.advance('contracts');
      await generateWorkspaceContractsInProcess(workspaceOrgId, {
        onSliceProgress: (done, total) =>
          void tracker.detail('contracts', `${done}/${total} slices`),
        onRepairProgress: (done, total) =>
          void tracker.detail('contracts', `repairing ${done}/${total}`),
      });
      const done = await jobStore.markSucceeded(jobId, {});
      const note = await notifications.add({
        org: workspaceOrgId,
        kind: WORKSPACE_CONTRACTS_TASK,
        level: 'success',
        title: 'Workspace contracts updated',
        body: 'Knowledge contracts regenerated from your resolved spec.',
        data: { jobId },
      });
      if (done) await publishEvent(db, workspaceOrgId, { type: 'job.progress', job: done });
      await publishEvent(db, workspaceOrgId, { type: 'notification', notification: note, jobId });
    } catch (err) {
      const message = (err as Error).message;
      const failed = await jobStore.markFailed(jobId, message);
      const note = await notifications.add({
        org: workspaceOrgId,
        kind: WORKSPACE_CONTRACTS_TASK,
        level: 'error',
        title: 'Contract generation failed — Workspace Knowledge',
        body: contractFailureBody(message),
        data: { jobId, detail: message },
      });
      if (failed) await publishEvent(db, workspaceOrgId, { type: 'job.progress', job: failed });
      await publishEvent(db, workspaceOrgId, { type: 'notification', notification: note, jobId });
      captureEeException(err, {
        component: 'knowledge',
        orgId: workspaceOrgId,
        route: 'worker workspace.contracts',
      });
      throw err;
    }
  };

  const runner = await run({
    connectionString: deps.connectionString,
    concurrency: 2,
    // ee-server owns SIGTERM/SIGINT (sentry flush + runner.stop in registerJobs).
    noHandleSignals: true,
    taskList: {
      [KNOWLEDGE_SYNC_TASK]: withTrace<SyncJobPayload>(
        (p) => jobTrace(p.org, p.jobId),
        knowledgeSync,
      ),
      [REPO_BASELINE_TASK]: withTrace<BaselineJobPayload>(
        (p) => jobTrace(p.workspaceOrgId, p.jobId, { repoFullName: p.repoFullName, commitSha: p.commitSha }),
        repoBaseline,
      ),
      [REPO_CONTRACTS_TASK]: withTrace<ContractsJobPayload>(
        (p) => jobTrace(p.workspaceOrgId, p.jobId, { repoFullName: p.repoKey }),
        repoContracts,
      ),
      [WORKSPACE_CONTRACTS_TASK]: withTrace<WorkspaceContractsJobPayload>(
        (p) => jobTrace(p.workspaceOrgId, p.jobId),
        workspaceContracts,
      ),
    },
  });
  log.info('[ee-jobs] worker runner started');
  return runner;
}
