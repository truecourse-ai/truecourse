/**
 * PR open/closed/merged state tracking. Every pull_request webhook upserts the
 * PR's current state into the gate store so the dashboard feed can filter
 * (GitHub-style: Open by default, with a Closed toggle). Independent of the gate
 * flow — it runs first and is non-fatal on failure.
 */

import type { GateStore, PrState } from './store/types.js';
import type { PullRequestPayload } from './webhook.js';

/**
 * Derive the tracked state from the webhook: a `closed` action resolves to
 * `merged` (merged flag set) or `closed`; any other action means the PR is
 * currently open (opened / reopened / synchronize / edited / …).
 */
export function prStateFromPayload(payload: PullRequestPayload): PrState {
  if (payload.action === 'closed') {
    return payload.pull_request.merged === true ? 'merged' : 'closed';
  }
  return 'open';
}

/** Upsert the PR's tracked state + title + head from a pull_request webhook. */
export async function upsertPrState(
  store: GateStore,
  payload: PullRequestPayload,
): Promise<void> {
  await store.upsertPr({
    repoFullName: payload.repository.full_name,
    prNumber: payload.number,
    title: payload.pull_request.title ?? null,
    state: prStateFromPayload(payload),
    headSha: payload.pull_request.head.sha,
    updatedAt: new Date().toISOString(),
  });
}
