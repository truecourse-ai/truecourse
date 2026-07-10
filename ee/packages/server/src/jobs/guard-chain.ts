/**
 * Guard onboarding chain — enqueue a hosted guard-generate after a repo's FIRST
 * successful baseline. The baseline's spec scan just persisted the curated
 * corpus, so this is the earliest moment guard generation has its doc universe
 * (a connect-time enqueue would race the scan).
 *
 * Scope is ONBOARDING ONLY: a repo that already has hosted guard state (a stored
 * generate report — the durable marker that a generate completed) never
 * re-chains here; refresh-on-merge is issue 06. A failed baseline never chains
 * (no fresh corpus). A noCorpus generate persists NO report, so the chain
 * naturally re-fires after the next successful baseline — exactly when specs
 * appear. Best-effort: failures are logged, never thrown into the baseline's
 * terminal path; the single-flight `repo.guard` key makes double-enqueue a no-op.
 */

import { log } from '@truecourse/core/lib/logger';
import type { JobOutcomeStatus } from './harness.js';
import type { BaselineJobPayload, GuardGenerateEnqueueRequest } from './constants.js';

export interface GuardChainDeps {
  /** Whether the repo already has hosted guard state (a stored generate report). */
  hasGuardState(repoKey: string): Promise<boolean>;
  /** Single-flight guard-generate enqueue (null = already running). */
  enqueueGuardGenerate(req: GuardGenerateEnqueueRequest): Promise<string | null>;
}

/** Returns the enqueued job id, or null when the chain (correctly) did nothing. */
export async function chainGuardOnboarding(
  deps: GuardChainDeps,
  payload: BaselineJobPayload,
  outcome: JobOutcomeStatus,
): Promise<string | null> {
  if (outcome !== 'succeeded') return null;
  const { repoFullName, installationId, defaultBranch, commitSha, workspaceOrgId } = payload;
  try {
    if (await deps.hasGuardState(repoFullName)) return null;
    return await deps.enqueueGuardGenerate({
      repoFullName,
      installationId,
      defaultBranch,
      commitSha,
      workspaceOrgId,
    });
  } catch (err) {
    log.warn(
      `[ee-jobs] guard onboarding chain failed for ${payload.repoFullName}: ${(err as Error).message}`,
    );
    return null;
  }
}
