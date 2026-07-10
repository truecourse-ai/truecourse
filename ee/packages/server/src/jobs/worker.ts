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
import type { EeDb } from '@truecourse/ee-db';
import { JobStore, NotificationStore, WorkspaceSettingsStore } from '@truecourse/ee-data-store';
import { runWithTrace, type TraceContext } from '@truecourse/ee-llm';
import { log } from '@truecourse/core/lib/logger';
import {
  runBaseline,
  loadGithubAppConfig,
  createGithubAuth,
  installationOctokit,
  selectGateStore,
  defaultGuardOnboardingPipeline,
  type BaselineResult,
  type GuardOnboardingPipeline,
} from '@truecourse/ee-github-app';
import type { NotificationLevel } from '@truecourse/shared';
import { CURATE_STEPS } from '@truecourse/core/commands/spec-in-process';
import { GUARD_GENERATE_STEPS } from '@truecourse/core/commands/guard-in-process';
import { StepTracker, type AnalysisProgressPayload } from '@truecourse/core/progress';
import { JobStepTracker } from './steps.js';
import { executeJob, type JobDefinition, type JobOutcomeStatus, type JobRuntime } from './harness.js';
import {
  REPO_BASELINE_TASK,
  REPO_BASELINE_TITLE,
  REPO_BASELINE_STEPS,
  REPO_GUARD_TASK,
  REPO_GUARD_TITLE,
  REPO_GUARD_STEPS,
  type BaselineJobPayload,
  type GuardGenerateJobPayload,
} from './constants.js';

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
  db: EeDb;
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

// --- Job definitions -------------------------------------------------

/** Initial / refresh scan of a connected repo: spec (conflict detection) + the
 *  Code Quality analyze pass — all via runBaseline. */
function repoBaselineJob(
  db: EeDb,
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
export function guardGenerateJob(
  pipeline: GuardOnboardingPipeline,
): JobDefinition<GuardGenerateJobPayload> {
  return {
    type: REPO_GUARD_TASK,
    title: REPO_GUARD_TITLE,
    steps: REPO_GUARD_STEPS,
    org: (p) => p.workspaceOrgId,
    traceMeta: (p) => ({ repoFullName: p.repoFullName, commitSha: p.commitSha }),
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
        },
      );

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

/**
 * Wrap a job definition as a graphile task: resolve the payload → ambient trace
 * context (org / job / repo) the EE transport tags LLM traces with, then run the
 * shared lifecycle. A definition factory (vs a plain definition) is resolved
 * per-invocation.
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

/** Deps the exported `runGuardGenerate` test seam needs — the stores + the
 *  onboarding pipeline (faked in tests; `defaultGuardOnboardingPipeline` live). */
export interface RunGuardGenerateDeps {
  db: EeDb;
  jobStore: JobStore;
  notifications: NotificationStore;
  pipeline: GuardOnboardingPipeline;
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
    guardGenerateJob(deps.pipeline),
    payload,
  );
}

export async function startWorker(deps: StartWorkerDeps): Promise<Runner> {
  const { db, jobStore } = deps;
  const notifications = new NotificationStore(db);
  const rt: JobRuntime = { db, jobStore, notifications };

  const runner = await run({
    connectionString: deps.connectionString,
    concurrency: 2,
    // ee-server owns SIGTERM/SIGINT (sentry flush + runner.stop in registerJobs).
    noHandleSignals: true,
    taskList: {
      [REPO_BASELINE_TASK]: registerJob(rt, repoBaselineJob(db, deps.onBaselineSettled)),
      [REPO_GUARD_TASK]: registerJob(rt, guardGenerateJob(defaultGuardOnboardingPipeline)),
    },
  });
  log.info('[ee-jobs] worker runner started');
  return runner;
}
