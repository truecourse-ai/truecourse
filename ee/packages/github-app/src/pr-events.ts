/**
 * Shared helpers for the PR-event handlers (the Code Quality gate and the guard
 * gate). The PR actions we react to, the permissions that authorize an
 * actor-triggered run, and the fork check (a head in a different repo).
 */

import type { PullRequestPayload } from '@truecourse/scm-github';

/** PR actions that (re)trigger our handlers — one shared list for all of them. */
export const PR_TRIGGER_ACTIONS = ['opened', 'synchronize', 'reopened'];

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
