/**
 * The pull requests of ONE repository, as the gate saw them: every gate run it
 * wrote, joined with the state the PR is in (open, closed, merged).
 *
 * The server's row is a RUN, one per pushed head, so a PR with three pushes has
 * three of them. The list is per PULL REQUEST, so the newest run of each is the
 * one that speaks for it, which is also what a reader means by "the check on
 * this PR".
 *
 * `prState` is null for a PR opened before the gate tracked closes; it was never
 * observed to close, so it reads as open.
 */

import { fetchApi } from '@/lib/api';
import type { GithubRunSummary } from '@truecourse/shared';

export type PullRequestState = 'open' | 'closed' | 'merged';

export interface PullRequestRow extends GithubRunSummary {
  /** Null for a pull request opened before close-tracking; reads as open. */
  prState: PullRequestState | null;
  title: string | null;
}

interface RepoGateRunsResponse {
  runs: PullRequestRow[];
}

/** Is this pull request still open? A row with no tracked state reads as open. */
export function isOpenPullRequest(state: PullRequestState | null): boolean {
  return state === 'open' || state == null;
}

/**
 * One row per pull request, newest run first. With no gate behind the server the
 * read answers nothing, which is the honest answer for a repository whose pull
 * requests were never checked.
 */
export async function fetchPullRequests(repoFullName: string): Promise<PullRequestRow[]> {
  const body = await fetchApi<RepoGateRunsResponse>(
    `/api/ee/github/repos/${repoFullName}/runs`,
  );
  const newest = new Map<number, PullRequestRow>();
  for (const run of [...body.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (!newest.has(run.prNumber)) newest.set(run.prNumber, run);
  }
  return [...newest.values()];
}
