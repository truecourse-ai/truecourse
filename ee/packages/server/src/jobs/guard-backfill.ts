/**
 * Deploy-time guard backfill (issue 06): a one-time pass that bootstraps every
 * already-connected repo onto the hosted guard gate, so existing fleets don't pay
 * generate-plus-double-run inside their first PR after the swap.
 *
 * Per connected+enabled repo NOT yet marked:
 *   - no scenarios yet  → enqueue a guard-generate (the baseline warms afterwards
 *                          via the generate→baseline chain);
 *   - scenarios but no baseline → enqueue a guard-baseline refresh directly;
 *   - both present      → nothing to do.
 * Each processed repo is then marked, so a re-deploy skips it entirely (a repo
 * with no spec docs never gains guard state, so a state-only check would
 * re-enqueue every deploy — decision 3). A repo that was never scanned (no
 * baseline commit) is skipped WITHOUT marking: the onboarding chain covers it
 * after its first scan, and a later deploy can still back it up if needed
 * (decision 4).
 *
 * Every enqueued job is stamped with that repo's own `workspaceOrgId`, so jobs-UI
 * visibility stays per-tenant. Fire-and-forget at boot — best-effort, never throws.
 */

import { log } from '@truecourse/core/lib/logger';
import type { OperatorRepoRef } from '@truecourse/ee-github-app';
import type { GuardGenerateEnqueueRequest, GuardBaselineEnqueueRequest } from './constants.js';

export interface GuardBackfillDeps {
  /**
   * Connected + enabled repos across ALL workspaces (operator-scoped enumeration).
   * The projection is exactly {@link OperatorRepoRef} — the backfill considers one
   * repo per row.
   */
  listRepos(): Promise<OperatorRepoRef[]>;
  /** The repo's last-scanned default-branch head (cached baseline), or null. */
  baselineCommit(repoFullName: string): Promise<string | null>;
  /** Whether the repo already has generated scenarios (a stored generate report). */
  hasScenarios(repoKey: string): Promise<boolean>;
  /** Whether the repo already has a guard baseline (a stored LATEST run). */
  hasBaseline(repoKey: string): Promise<boolean>;
  /** Run-once marker: whether a prior backfill already processed the repo. */
  isBackfilled(repoFullName: string): Promise<boolean>;
  markBackfilled(repoFullName: string): Promise<void>;
  enqueueGuardGenerate(req: GuardGenerateEnqueueRequest): Promise<string | null>;
  enqueueGuardBaseline(req: GuardBaselineEnqueueRequest): Promise<string | null>;
}

export interface GuardBackfillSummary {
  generateEnqueued: number;
  baselineEnqueued: number;
  skipped: number;
}

export async function runGuardBackfill(deps: GuardBackfillDeps): Promise<GuardBackfillSummary> {
  const summary: GuardBackfillSummary = { generateEnqueued: 0, baselineEnqueued: 0, skipped: 0 };

  let repos: OperatorRepoRef[];
  try {
    repos = await deps.listRepos();
  } catch (err) {
    log.warn(`[ee-jobs] guard backfill: enumerating repos failed: ${(err as Error).message}`);
    return summary;
  }

  for (const repo of repos) {
    try {
      if (await deps.isBackfilled(repo.repoFullName)) {
        summary.skipped += 1;
        continue;
      }
      const commitSha = await deps.baselineCommit(repo.repoFullName);
      if (!commitSha) {
        // Never scanned — the onboarding chain picks it up after its first scan.
        // Left unmarked so a post-scan deploy can still back it up.
        summary.skipped += 1;
        continue;
      }
      const req = {
        repoFullName: repo.repoFullName,
        installationId: repo.installationId,
        defaultBranch: repo.defaultBranch,
        commitSha,
        workspaceOrgId: repo.workspaceOrgId,
      };
      if (!(await deps.hasScenarios(repo.repoFullName))) {
        // Count only a real enqueue — a null return means the request coalesced onto
        // an in-flight job (single-flight / pending buffer) and did NOT add work.
        if ((await deps.enqueueGuardGenerate(req)) !== null) summary.generateEnqueued += 1;
      } else if (!(await deps.hasBaseline(repo.repoFullName))) {
        if ((await deps.enqueueGuardBaseline(req)) !== null) summary.baselineEnqueued += 1;
      } else {
        summary.skipped += 1;
      }
      await deps.markBackfilled(repo.repoFullName);
    } catch (err) {
      log.warn(
        `[ee-jobs] guard backfill for ${repo.repoFullName} failed: ${(err as Error).message}`,
      );
    }
  }

  return summary;
}
