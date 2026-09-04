/**
 * `repo.guard-run` — `truecourse guard run` over an ephemeral clone: the
 * repository's BASELINE run.
 *
 * The last link of onboarding: a generate that authored scenarios chains into
 * it, and the Run button enqueues it. The runner is deterministic and reads
 * files, so the job brackets it the way the generate job does: the baseline
 * scenario set and setup's newest bundle (the recipe, the dependency catalog,
 * the interface catalog the drift annotation reads) are materialized into the
 * clone, the committed scenarios run against the program the recipe builds,
 * and what the run left — the run snapshot and every scenario's evidence,
 * transcripts and browser screenshots alike — is saved back under the clone's
 * commit as the repo's guard baseline. The job only ever runs on the default
 * branch.
 *
 * The one LLM call a run can make, the visual judge over a failing web step's
 * screenshot, rides the asking workspace's provider — and only when the judge
 * is switched on; it is parked by default.
 *
 * A run that could not start (no recipe, no scenarios, a build that failed)
 * persists nothing and fails the job with the runner's own message. A
 * cancelled run leaves the store exactly as it found it.
 */

import { resolveCommitSha } from '@truecourse/core/lib/repo-ref';
import { emitRepoLifecycle } from '@truecourse/core/lib/repo-lifecycle';
import { loadGuardSetupBundle } from '@truecourse/core/lib/guard-store';
import { materializeGuardOverlays } from '@truecourse/core/lib/guard-overlays';
import { materializeGuardSetupBundle } from '@truecourse/core/services/guard-setup/bundle';
import {
  createGuardVisualJudge,
  guardVisualJudgeEnabled,
} from '@truecourse/core/services/llm/guard-visual-judge';
import { guardRunInProcess, GUARD_RUN_STEPS } from '@truecourse/core/commands/guard-in-process';
import { runFailureMessage } from '@truecourse/guard-runner';
import type { GuardSummary } from '@truecourse/shared';
import type { JobDefinition, JobPayload } from '@truecourse/jobs';
import { startWorkspaceLlm, type WorkspaceLlm } from '../../services/workspace-llm.service.js';
import { acquireWorkTree } from '../../services/work-tree.service.js';
import { materializeStoredGuardState, persistGuardRun } from '../materialize-guard.js';
import { firstLine, mirrorTracker, type OnboardingJobRequest } from './onboarding.js';

export const REPO_GUARD_RUN_TASK = 'repo.guard-run';

export type GuardRunJobRequest = OnboardingJobRequest;

export type GuardRunJobPayload = GuardRunJobRequest & JobPayload;

/** What the job row records about a run that completed. */
export interface GuardRunJobResult {
  repoFullName: string;
  runId: string;
  summary: GuardSummary;
}

/** The engines the body drives — production wires the real ones. */
export interface RepoGuardRunTaskDeps {
  startLlm?: (orgId: string) => Promise<WorkspaceLlm>;
  runGuard?: typeof guardRunInProcess;
}

export function createRepoGuardRunTask(
  deps: RepoGuardRunTaskDeps = {},
): JobDefinition<GuardRunJobPayload> {
  const startLlm = deps.startLlm ?? startWorkspaceLlm;
  const runGuard = deps.runGuard ?? guardRunInProcess;

  return {
    type: REPO_GUARD_RUN_TASK,
    title: 'Running scenarios',
    steps: [{ key: 'clone', label: 'Cloning repository' }, ...GUARD_RUN_STEPS],
    org: (payload) => payload.workspaceOrgId,
    traceMeta: (payload) => ({ repoFullName: payload.repoFullName }),

    async run(ctx) {
      const { repoFullName } = ctx.payload;
      // The judge is the run's only model call and it is parked by default, so
      // the workspace's provider is resolved only when it would actually be used.
      const llm = guardVisualJudgeEnabled() ? await startLlm(ctx.payload.workspaceOrgId) : null;

      await ctx.phase('clone');
      const tree = await acquireWorkTree(repoFullName);
      try {
        const commitSha = await resolveCommitSha(tree.dir);
        const baseline = await materializeStoredGuardState(repoFullName, tree.dir);
        if (!baseline) {
          throw new Error(
            `${repoFullName} has no generated scenarios yet — run guard generate before running them.`,
          );
        }
        // Setup's bundle goes in LAST: its recipe and catalogs are the current
        // truth, whatever the scenario set was generated against.
        const bundle = await loadGuardSetupBundle(repoFullName);
        if (!bundle) {
          throw new Error(
            `${repoFullName} has not been set up yet — run guard setup before running scenarios.`,
          );
        }
        materializeGuardSetupBundle(tree.dir, bundle);
        // The registered instances beside it: a supplied dependency binds only
        // to what was provided, and the runner reads that from the two overlay files.
        await materializeGuardOverlays(repoFullName, tree.dir);

        const result = await runGuard(tree.dir, {
          tracker: mirrorTracker(ctx, GUARD_RUN_STEPS),
          ...(llm ? { visualJudge: createGuardVisualJudge(tree.dir, { transport: llm.transport() }) } : {}),
        });
        // A stop the user asked for: the harness settles the row cancelled, and
        // a store that never saw this run is exactly what a cancel means.
        if (ctx.signal?.aborted) return { notification: null };
        if (result.status !== 'ok') throw new Error(runFailureMessage(result));

        await persistGuardRun({ repoKey: repoFullName, commitSha }, tree.dir, result.latest);

        const { summary } = result.latest;
        const jobResult: GuardRunJobResult = {
          repoFullName,
          runId: result.latest.run.runId,
          summary,
        };
        const red = summary.fail + summary.error;
        return {
          result: jobResult,
          notification:
            red > 0
              ? {
                  level: 'warning',
                  title: 'Scenarios ran — failures to review',
                  body: `${repoFullName} — ${summary.pass} of ${summary.total} passed, ${red} failed.`,
                  data: { repoFullName, runId: jobResult.runId, summary },
                }
              : {
                  level: 'success',
                  title: 'Scenarios passed',
                  body: `${repoFullName} — ${summary.pass} of ${summary.total} passed.`,
                  data: { repoFullName, runId: jobResult.runId, summary },
                },
        };
      } finally {
        tree.dispose();
      }
    },

    onError: (err, payload) => ({
      level: 'error',
      title: 'Scenario run failed',
      body: `${payload.repoFullName} — ${firstLine(err.message)}`,
      data: { repoFullName: payload.repoFullName },
    }),

    async onSettled(ctx) {
      // Clears the in-page progress popup and refreshes the guard surfaces,
      // however the run ended. Nothing chains after the baseline run.
      await emitRepoLifecycle(ctx.payload.repoFullName, 'guard-run');
    },
  };
}
