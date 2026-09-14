/**
 * pull_request.closed handling. A PR's conflict resolutions are PR-scoped (a
 * decisions overlay). On merge they promote onto the repo row so the merged
 * spec's resolutions become canonical; on an unmerged close they're discarded.
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
import type { PullRequestPayload } from '@truecourse/github-app';

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
}
