/**
 * `repo.scan` — the spec scan of a connected repository, as a background job.
 *
 * Connecting a repository enqueues it, and so does the Scan button: the route
 * answers at once and the queue owns the work, so a slow scan can neither hold
 * a response nor die with it. A scan that succeeds chains straight into
 * `repo.guard-setup` — onboarding is one motion, and setup's own per-step
 * fingerprints decide whether anything actually re-runs.
 *
 * The provider is proved BEFORE the clone exists. A workspace with none
 * configured fails the job with the machine-readable code and records no run:
 * there was nothing to start it with. A provider that will not answer DOES get
 * a run record — a repository must show a failed scan rather than no scan.
 */

import { log } from '@truecourse/core/lib/logger';
import { CURATE_STEPS } from '@truecourse/core/commands/spec-in-process';
import { emitRepoLifecycle } from '@truecourse/core/lib/repo-lifecycle';
import { openConflicts } from '@truecourse/shared';
import type { JobDefinition } from '@truecourse/jobs';
import {
  LlmProbeFailedError,
  startWorkspaceLlm,
  type WorkspaceLlm,
} from '../../services/workspace-llm.service.js';
import { recordFailedScanRun, runStoredSpecScan } from '../../services/spec-scan.service.js';
import {
  pipelineTracker,
  type OnboardingJobPayload,
  type OnboardingJobRequest,
} from './onboarding.js';

export const REPO_SCAN_TASK = 'repo.scan';

/** The engines the body drives — production wires the real ones. */
export interface RepoScanTaskDeps {
  /** Enqueue the guard setup a successful scan chains into. */
  chainGuardSetup(request: OnboardingJobRequest): Promise<void>;
  startLlm?: (orgId: string) => Promise<WorkspaceLlm>;
  runScan?: typeof runStoredSpecScan;
}

export function createRepoScanTask(
  deps: RepoScanTaskDeps,
): JobDefinition<OnboardingJobPayload> {
  const startLlm = deps.startLlm ?? startWorkspaceLlm;
  const runScan = deps.runScan ?? runStoredSpecScan;

  return {
    type: REPO_SCAN_TASK,
    title: 'Scanning repository',
    steps: [
      { key: 'clone', label: 'Cloning repository' },
      { key: 'spec', label: 'Curating the spec' },
    ],
    org: (payload) => payload.workspaceOrgId,
    traceMeta: (payload) => ({ repoFullName: payload.repoFullName }),

    async run(ctx) {
      const { repoFullName } = ctx.payload;
      let llm: WorkspaceLlm;
      try {
        llm = await startLlm(ctx.payload.workspaceOrgId);
      } catch (err) {
        // The probe died before curate could open a run — create one carrying
        // the reason, so Activity shows a failed scan instead of nothing at all.
        if (err instanceof LlmProbeFailedError) {
          recordFailedScanRun(repoFullName, { message: err.message, kind: 'llm-probe' });
        }
        throw err;
      }

      await ctx.phase('clone');
      const result = await runScan(repoFullName, {
        tracker: pipelineTracker(ctx, 'spec', CURATE_STEPS),
        source: 'dashboard',
        driver: llm.driver(),
        transportMode: llm.mode,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });

      const conflicts = openConflicts(result.curate.corpus, result.curate.decisions).length;
      return {
        result: { repoFullName, openConflicts: conflicts },
        notification:
          conflicts > 0
            ? {
                level: 'warning',
                title: 'Repository scanned — conflicts to resolve',
                body: `${repoFullName} — spec is ready, but ${conflicts} open conflict${conflicts === 1 ? '' : 's'} must be resolved.`,
                data: { repoFullName, openConflicts: conflicts },
              }
            : {
                level: 'success',
                title: 'Repository scan complete',
                body: `${repoFullName} — the spec is ready.`,
                data: { repoFullName },
              },
      };
    },

    onError: (err, payload) => ({
      level: 'error',
      title: 'Repository scan failed',
      body: `${payload.repoFullName} — ${err.message}`,
      data: { repoFullName: payload.repoFullName },
    }),

    async onSettled(ctx, outcome) {
      // Clears the in-page progress popup and refreshes the spec surfaces,
      // however the scan ended.
      await emitRepoLifecycle(ctx.payload.repoFullName, 'scan');
      if (outcome !== 'succeeded') return;
      try {
        // A fresh request, not this job's payload: the chained job gets its own
        // row id from the enqueue, never the scan's.
        const { repoId, repoFullName, workspaceOrgId } = ctx.payload;
        await deps.chainGuardSetup({ repoId, repoFullName, workspaceOrgId, source: 'chain' });
      } catch (err) {
        // A chain that cannot be enqueued is not this scan's failure: the scan
        // already succeeded, and setup can be started by hand.
        log.warn(
          `[jobs] could not chain guard setup for ${ctx.payload.repoFullName}: ${(err as Error).message}`,
        );
      }
    },
  };
}
