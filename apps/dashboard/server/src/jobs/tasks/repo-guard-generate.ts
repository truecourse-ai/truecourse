import { dashboardActivity } from '../../services/dashboard-activity.service.js';
/**
 * `repo.guard-generate` — `truecourse guard generate` over an ephemeral clone.
 *
 * The third link of onboarding: a successful setup chains into it, and the
 * Generate button enqueues it. The generator reads and writes files, so the
 * job brackets it the way the setup job does: the stored spec, the repo's
 * guard state (decisions, the baseline scenario set and report) and setup's
 * newest bundle are materialized into the clone first, and what the generate
 * wrote — the scenario tree, the report, the birth-finding transcripts — is
 * saved back under the clone's commit after, flagged as the repo's guard
 * baseline: the job only ever runs on the default branch.
 *
 * Nothing is persisted from a generate that authored nothing. A corpus still
 * carrying open conflicts is the one exception: its blocked report is stored so
 * the guard surfaces can say WHY there are no scenarios, and the job settles
 * as a warning rather than a failure — the remedy is a resolution, not a retry.
 * A cancelled generate leaves the store exactly as it found it.
 *
 * A generate that produced a scenario set chains into the BASELINE RUN — the
 * last link of onboarding — so every connected repository ends up with a run
 * on record, not just a set of scenarios.
 */

import { log } from '@truecourse/core/lib/logger';
import { resolveCommitSha } from '@truecourse/core/lib/repo-ref';
import { emitRepoLifecycle } from '@truecourse/core/lib/repo-lifecycle';
import { loadGuardSetupBundle, writeGuardResult } from '@truecourse/core/lib/guard-store';
import { materializeGuardOverlays } from '@truecourse/core/lib/guard-overlays';
import { materializeGuardSetupBundle } from '@truecourse/core/services/guard-setup/bundle';
import {
  buildGuardReport,
  buildOpenConflictsReport,
  guardGenerateInProcess,
  GUARD_GENERATE_STEPS,
  OpenConflictsError,
} from '@truecourse/core/commands/guard-in-process';
import type { JobDefinition, JobPayload } from '@truecourse/jobs';
import { startWorkspaceLlm, type WorkspaceLlm } from '../../services/workspace-llm.service.js';
import { acquireWorkTree } from '../../services/work-tree.service.js';
import { materializeStoredSpec } from '../materialize-spec.js';
import {
  materializeStoredGuardState,
  persistGeneratedGuard,
  readGeneratedReport,
} from '../materialize-guard.js';
import { firstLine, type OnboardingJobRequest } from './onboarding.js';

export const REPO_GUARD_GENERATE_TASK = 'repo.guard-generate';

export type GuardGenerateJobRequest = OnboardingJobRequest;

export type GuardGenerateJobPayload = GuardGenerateJobRequest & JobPayload;

/** What the job row records about a generate that ran. */
export interface GuardGenerateJobResult {
  repoFullName: string;
  status: 'ok' | 'open-conflicts';
  /** Scenarios authored this run (0 when nothing changed). */
  written: number;
  birthFindings: number;
  noChanges: boolean;
  /** The conflicts that blocked the run — only with `status: 'open-conflicts'`. */
  openConflicts: number;
}

/** The engines the body drives — production wires the real ones. */
export interface RepoGuardGenerateTaskDeps {
  /** Enqueue the baseline run a generate with scenarios chains into. */
  chainGuardRun(request: OnboardingJobRequest): Promise<void>;
  startLlm?: (orgId: string) => Promise<WorkspaceLlm>;
  runGenerate?: typeof guardGenerateInProcess;
}

export function createRepoGuardGenerateTask(
  deps: RepoGuardGenerateTaskDeps,
): JobDefinition<GuardGenerateJobPayload> {
  const startLlm = deps.startLlm ?? startWorkspaceLlm;
  const runGenerate = deps.runGenerate ?? guardGenerateInProcess;

  return {
    type: REPO_GUARD_GENERATE_TASK,
    title: 'Generating scenarios',
    steps: [{ key: 'clone', label: 'Cloning repository' }, ...GUARD_GENERATE_STEPS],
    org: (payload) => payload.workspaceOrgId,
    traceMeta: (payload) => ({ repoFullName: payload.repoFullName }),

    async run(ctx) {
      return dashboardActivity(ctx, 'guard-generate', GUARD_GENERATE_STEPS, async (activityRun, activityTracker) => {
        const { repoFullName } = ctx.payload;
        const llm = await startLlm(ctx.payload.workspaceOrgId);

        await ctx.phase('clone');
        const tree = await acquireWorkTree(repoFullName);
        try {
          const commitSha = await resolveCommitSha(tree.dir);
          activityRun.setGitRef?.(commitSha);
          activityTracker.fact('clone', `cloned ${repoFullName} at ${commitSha.slice(0, 8)}`);
          const ref = { repoKey: repoFullName, commitSha };
          if (!(await materializeStoredSpec(ref, tree.dir))) {
            throw new Error(
              `${repoFullName} has no scanned spec yet — run the spec scan before generating scenarios.`,
            );
          }
          activityTracker.fact('clone', 'the stored spec corpus and decisions written into the clone');
          const baseline = await materializeStoredGuardState(repoFullName, tree.dir);
          activityTracker.fact(
            'clone',
            baseline
              ? `the baseline scenario set and report from ${baseline.slice(0, 8)} written into the clone`
              : 'no baseline scenario set: this generate starts from nothing',
          );
          // Setup's bundle goes in LAST: its recipe and catalogs are the current
          // truth, whatever the scenario set was generated against.
          const bundle = await loadGuardSetupBundle(repoFullName);
          if (!bundle) {
            throw new Error(
              `${repoFullName} has not been set up yet — run guard setup before generating scenarios.`,
            );
          }
          materializeGuardSetupBundle(tree.dir, bundle);
          activityTracker.fact('clone', `the newest setup bundle written into the clone: ${Object.keys(bundle).join(', ')}`);
          // The registered instances beside it: what a supplied dependency is
          // provided with decides which sections generate can author.
          if (await materializeGuardOverlays(repoFullName, tree.dir)) {
            activityTracker.fact('clone', 'the registered instances written into the clone');
          }
          activityTracker.done('clone');

          let guard;
          try {
            const driver = llm.driver();
            ({ guard } = await runGenerate(tree.dir, {
              driver,
              transport: llm.transport(),
              transportMode: llm.mode,
              attribution: driver.attribution,
              sessionsKey: repoFullName,
              sessionRun: activityRun,
              tracker: activityTracker,
              requireExistingRecipe: true,
              ...(ctx.signal ? { signal: ctx.signal } : {}),
            }));
          } catch (err) {
            if (ctx.signal?.aborted) throw err;
            if (err instanceof OpenConflictsError) {
              // The engine already stopped the run on the gate's reason.
              await writeGuardResult(ref, buildOpenConflictsReport(err, new Date().toISOString()), {
                baseline: true,
              });
              const result: GuardGenerateJobResult = {
                repoFullName,
                status: 'open-conflicts',
                written: 0,
                birthFindings: 0,
                noChanges: false,
                openConflicts: err.conflicts.length,
              };
              return {
                result,
                notification: {
                  level: 'warning',
                  title: 'Scenario generation blocked',
                  body: `${repoFullName} — ${firstLine(err.message)}`,
                  data: { repoFullName, openConflicts: err.conflicts.length },
                },
              };
            }
            throw err;
          }
          // A stop the user asked for: the harness settles the row cancelled, and
          // a store that never saw this run is exactly what a cancel means.
          if (ctx.signal?.aborted) return { notification: null };
          if (guard.status !== 'ok') {
            throw new Error(guard.reason ?? `guard generate ended ${guard.status}.`);
          }

          // The report the engine left in the tree is what gets stored, so the
          // row's counts come from it too — never from a result it could differ from.
          const report = readGeneratedReport(tree.dir) ?? buildGuardReport(guard, new Date().toISOString());
          await persistGeneratedGuard(ref, tree.dir, report);

          // Keep successful documents and the failure report, but do not present
          // an incomplete extraction as success or chain its baseline run.
          if (report.extractionFailures.length > 0) {
            const docs = report.extractionFailures.map(failure => failure.doc).join(', ');
            activityTracker.error('extract', `Claim extraction failed for ${docs}`);
            throw new Error(
              `Claim extraction failed for ${docs}. Partial results were saved. Retry generation to complete coverage.`,
            );
          }

          const written = report.written.length;
          const findings = report.birthFindings.length;
          const result: GuardGenerateJobResult = {
            repoFullName,
            status: 'ok',
            written,
            birthFindings: findings,
            noChanges: report.noChanges,
            openConflicts: 0,
          };
          return {
            result,
            notification: report.noChanges
              ? {
                  level: 'success',
                  title: 'Scenarios up to date',
                  body: `${repoFullName} — nothing changed since the last generate.`,
                  data: { repoFullName },
                }
              : findings > 0
                ? {
                    level: 'warning',
                    title: 'Scenarios generated — findings to review',
                    body: `${repoFullName} — ${written} scenario${written === 1 ? '' : 's'} written, ${findings} birth finding${findings === 1 ? '' : 's'}.`,
                    data: { repoFullName, written, birthFindings: findings },
                  }
                : {
                    level: 'success',
                    title: 'Scenarios generated',
                    body: `${repoFullName} — ${written} scenario${written === 1 ? '' : 's'} written.`,
                    data: { repoFullName, written },
                  },
          };
        } finally {
          tree.dispose();
        }
      });
    },

    onError: (err, payload) => ({
      level: 'error',
      title: 'Scenario generation failed',
      body: `${payload.repoFullName} — ${firstLine(err.message)}`,
      data: { repoFullName: payload.repoFullName },
    }),

    async onSettled(ctx, outcome, result) {
      // Clears the in-page progress popup and refreshes the guard surfaces,
      // however the generate ended.
      await emitRepoLifecycle(ctx.payload.repoFullName, 'guard-generate');
      // Only a generate that left a scenario set has anything to run: a blocked
      // corpus ends the chain here (its notification already says why), and so
      // does a failure or a cancel. An unchanged set still runs — the code under
      // it may have moved, and the baseline run is what says so.
      if (outcome !== 'succeeded') return;
      if ((result as { status?: string } | undefined)?.status !== 'ok') return;
      try {
        // A fresh request, not this job's payload: the chained job gets its own
        // row id from the enqueue, never generate's.
        const { repoId, repoFullName, workspaceOrgId } = ctx.payload;
        await deps.chainGuardRun({ repoId, repoFullName, workspaceOrgId, source: 'chain' });
      } catch (err) {
        // A chain that cannot be enqueued is not this generate's failure: the
        // scenarios are stored, and the run can be started by hand.
        log.warn(
          `[jobs] could not chain the baseline run for ${ctx.payload.repoFullName}: ${(err as Error).message}`,
        );
      }
    },
  };
}
