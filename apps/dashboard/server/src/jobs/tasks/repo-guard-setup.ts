/**
 * `repo.guard-setup` — `truecourse guard setup` over an ephemeral clone.
 *
 * Setup writes files INSIDE the repo (the recipe, the dependency catalog, the
 * seed script, its own step spine), and a hosted clone is thrown away when the
 * run settles. So the job brackets the engine with the two moves that make its
 * state durable: materialize the stored spec and the newest setup BUNDLE into
 * the clone before running, and save the clone's bundle back under its commit
 * after. That bundle is what carries the per-step fingerprints forward, so a
 * re-run over unchanged inputs settles every step without spending.
 *
 * A repository with no stored corpus is refused up front — setup reads the
 * curated doc universe, and there is nothing to catalogue against without it.
 */

import { resolveCommitSha } from '@truecourse/core/lib/repo-ref';
import { emitRepoLifecycle } from '@truecourse/core/lib/repo-lifecycle';
import {
  loadGuardSetupBundle,
  saveGuardSetupBundle,
} from '@truecourse/core/lib/guard-store';
import {
  collectGuardSetupBundle,
  materializeGuardSetupBundle,
} from '@truecourse/core/services/guard-setup/bundle';
import {
  guardSetupInProcess,
  GUARD_SETUP_STEPS,
  type GuardSetupOnlyStep,
} from '@truecourse/core/commands/guard-setup';
import type { JobDefinition, JobPayload } from '@truecourse/jobs';
import { startWorkspaceLlm, type WorkspaceLlm } from '../../services/workspace-llm.service.js';
import { acquireWorkTree } from '../../services/work-tree.service.js';
import { materializeStoredSpec } from '../materialize-spec.js';
import { firstLine, mirrorTracker, type OnboardingJobRequest } from './onboarding.js';

export const REPO_GUARD_SETUP_TASK = 'repo.guard-setup';

/** Setup's own knobs, on top of what every onboarding job carries. */
export interface GuardSetupJobRequest extends OnboardingJobRequest {
  /** Run only this step, replaying the earlier ones from the bundle. */
  only?: GuardSetupOnlyStep;
  /** Re-derive the recipe and re-draft the seed even when both already exist. */
  refresh?: boolean;
}

export type GuardSetupJobPayload = GuardSetupJobRequest & JobPayload;

/** The engines the body drives — production wires the real ones. */
export interface RepoGuardSetupTaskDeps {
  startLlm?: (orgId: string) => Promise<WorkspaceLlm>;
  runSetup?: typeof guardSetupInProcess;
}

export function createRepoGuardSetupTask(
  deps: RepoGuardSetupTaskDeps = {},
): JobDefinition<GuardSetupJobPayload> {
  const startLlm = deps.startLlm ?? startWorkspaceLlm;
  const runSetup = deps.runSetup ?? guardSetupInProcess;

  return {
    type: REPO_GUARD_SETUP_TASK,
    title: 'Setting up guard',
    steps: [{ key: 'clone', label: 'Cloning repository' }, ...GUARD_SETUP_STEPS],
    org: (payload) => payload.workspaceOrgId,
    traceMeta: (payload) => ({ repoFullName: payload.repoFullName }),

    async run(ctx) {
      const { repoFullName, only, refresh } = ctx.payload;
      const llm = await startLlm(ctx.payload.workspaceOrgId);

      await ctx.phase('clone');
      const tree = await acquireWorkTree(repoFullName);
      try {
        const commitSha = await resolveCommitSha(tree.dir);
        const ref = { repoKey: repoFullName, commitSha };
        if (!(await materializeStoredSpec(ref, tree.dir))) {
          throw new Error(
            `${repoFullName} has no scanned spec yet — run the spec scan before guard setup.`,
          );
        }
        // The NEWEST bundle, not this commit's: what carries the settle spine
        // forward is the last setup that ran, whatever commit it ran on.
        const stored = await loadGuardSetupBundle(repoFullName);
        if (stored) materializeGuardSetupBundle(tree.dir, stored);

        const { report } = await runSetup(tree.dir, {
          driver: llm.driver(),
          transport: llm.transport(),
          transportMode: llm.mode,
          sessionsKey: repoFullName,
          eagerRun: true,
          tracker: mirrorTracker(ctx, GUARD_SETUP_STEPS),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
          ...(only ? { only } : {}),
          ...(refresh ? { refresh: true } : {}),
        });

        const files = collectGuardSetupBundle(tree.dir);
        if (Object.keys(files).length > 0) await saveGuardSetupBundle(ref, files);

        const reason = firstLine(report.reason);
        return {
          result: { repoFullName, status: report.status, ...(reason ? { reason } : {}) },
          notification:
            report.status === 'ok'
              ? {
                  level: 'success',
                  title: 'Guard setup complete',
                  body: `${repoFullName} — the recipe and its dependencies are ready.`,
                  data: { repoFullName },
                }
              : {
                  level: 'error',
                  title: 'Guard setup did not complete',
                  body: `${repoFullName} — ${reason || 'setup was refused.'}`,
                  data: { repoFullName },
                },
        };
      } finally {
        tree.dispose();
      }
    },

    onError: (err, payload) => ({
      level: 'error',
      title: 'Guard setup failed',
      body: `${payload.repoFullName} — ${err.message}`,
      data: { repoFullName: payload.repoFullName },
    }),

    async onSettled(ctx) {
      // Clears the in-page progress popup and refreshes the guard surfaces,
      // however setup ended. Nothing chains after it.
      await emitRepoLifecycle(ctx.payload.repoFullName, 'guard-setup');
    },
  };
}
