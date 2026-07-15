/**
 * pull_request.closed handling. A PR's conflict resolutions are PR-scoped (a
 * decisions overlay). On merge they promote onto the repo row so the merged
 * spec's resolutions become canonical; on an unmerged close they're discarded.
 * Either way the PR-scoped Code Quality diff is cleaned up (best-effort).
 *
 * Promotion is idempotent — the merge-commit baseline also promotes (the
 * push-before-closed race), and a second promotion is a no-op.
 */

import {
  promoteDecisionsOverlay,
  discardDecisionsOverlay,
} from '@truecourse/core/commands/spec-in-process';
import {
  promoteGuardDecisionsOverlay,
  discardGuardDecisionsOverlay,
} from '@truecourse/core/commands/guard-read';
import { deleteDiff } from '@truecourse/core/lib/analysis-store';
import { log } from '@truecourse/core/lib/logger';
import type { PullRequestPayload } from './webhook.js';

/** Key the gate writes the PR-scoped Code Quality diff under (gate-runner.ts). */
function prDiffKey(repoFullName: string, prNumber: number): string {
  return `${repoFullName}::pr/${prNumber}`;
}

export async function handlePullRequestClosed(payload: PullRequestPayload): Promise<void> {
  const repoFullName = payload.repository.full_name;
  const prNumber = payload.number;

  // The spec and guard overlays settle independently — one failing must not starve
  // the other. A failure still propagates (after both ran) so webhook redelivery
  // retries; promotion being idempotent makes the retry safe.
  const settled = await Promise.allSettled(
    payload.pull_request.merged === true
      ? [
          promoteDecisionsOverlay(repoFullName, prNumber),
          promoteGuardDecisionsOverlay(repoFullName, prNumber),
        ]
      : [
          discardDecisionsOverlay(repoFullName, prNumber),
          discardGuardDecisionsOverlay(repoFullName, prNumber),
        ],
  );
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) throw failed.reason;

  // The PR-scoped analyze diff is transient PR state — drop it once the PR closes.
  // Best-effort: a cleanup failure must not mask the (already-applied) promotion.
  try {
    await deleteDiff(prDiffKey(repoFullName, prNumber));
  } catch (err) {
    log.warn(
      `[github-app] PR-scoped diff cleanup failed for ${repoFullName} PR#${prNumber}: ${(err as Error).message}`,
    );
  }
}
