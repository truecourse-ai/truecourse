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
import type {
  BaselineJobPayload,
  GuardGenerateEnqueueRequest,
  GuardBaselineEnqueueRequest,
} from './constants.js';

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

/** The commit-carrying shape both chains project a guard-baseline request from
 *  (a settled repo.baseline OR a settled repo.guard payload — both carry these). */
export type GuardRefreshSource = GuardBaselineEnqueueRequest;

export interface GuardBaselineRefreshDeps {
  /** Whether the repo already has hosted guard state (a stored generate report). */
  hasGuardState(repoKey: string): Promise<boolean>;
  /** Single-flight (pending-buffer-aware) guard-baseline enqueue (null = coalesced/running). */
  enqueueGuardBaseline(req: GuardBaselineEnqueueRequest): Promise<string | null>;
}

/**
 * Refresh-on-merge / post-generate: enqueue a guard-baseline refresh iff the repo
 * ALREADY has scenarios — the exact COMPLEMENT of {@link chainGuardOnboarding}
 * (which fires only when the repo has none). Wired onto BOTH `onBaselineSettled`
 * (a default-branch merge just re-scanned the corpus → the baseline must re-run
 * against current main) and the guard-generate `onSettled` (a fresh generate just
 * wrote scenarios → warm the baseline so the first PR gate skips the lazy base
 * run). Success-only; best-effort — failures are logged, never thrown into the
 * settling job's terminal path; the pending buffer + single-flight key make a
 * duplicate a coalesced no-op.
 */
export async function chainGuardBaselineRefresh(
  deps: GuardBaselineRefreshDeps,
  payload: GuardRefreshSource,
  outcome: JobOutcomeStatus,
): Promise<string | null> {
  if (outcome !== 'succeeded') return null;
  const { repoFullName, installationId, defaultBranch, commitSha, workspaceOrgId } = payload;
  try {
    if (!(await deps.hasGuardState(repoFullName))) return null;
    return await deps.enqueueGuardBaseline({
      repoFullName,
      installationId,
      defaultBranch,
      commitSha,
      workspaceOrgId,
    });
  } catch (err) {
    log.warn(
      `[ee-jobs] guard baseline refresh chain failed for ${payload.repoFullName}: ${(err as Error).message}`,
    );
    return null;
  }
}
