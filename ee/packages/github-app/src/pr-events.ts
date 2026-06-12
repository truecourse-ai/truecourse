/**
 * Shared helpers for the PR-event handlers (the gate + the infer offer). The PR
 * actions we react to, the permissions that authorize an actor-triggered run,
 * and the fork check (a head in a different repo).
 */

import type { PullRequestPayload } from './webhook.js';

/** PR actions that (re)trigger our handlers. */
export const PR_OFFER_ACTIONS = ['opened', 'synchronize', 'reopened'];

/** Repository permissions that authorize an actor to trigger a run. */
export const WRITE_PERMISSIONS = ['admin', 'write', 'maintain'];

/** Whether the PR head lives in a different repo (a fork). */
export function isForkPr(
  payload: PullRequestPayload,
  baseFullName: string,
): boolean {
  const headRepo = payload.pull_request.head.repo;
  return !!headRepo && headRepo.full_name !== baseFullName;
}
