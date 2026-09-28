/**
 * The pull requests a list draws its Pull request column and filter from.
 *
 * Both reads are OPTIONAL to the page: a server without the pull request
 * routes (no GitHub App configured) answers 404, and the list then simply has
 * no pull requests, never an error. A page asks only when a connected
 * repository's provider has pull requests at all (`offersPullRequests`).
 */

import { useEffect, useState } from 'react';
import type { PullRequestListItem, PullRequestRecord, WorkspacePullRequestRow } from '@truecourse/shared';
import { getContextPullRequests, getRepoPullRequests } from '@/lib/api';

/** A repository's pull requests, open and closed, when `enabled`; `signal` re-reads. */
export function useRepoPullRequests(repoId: string, enabled: boolean, signal = 0): PullRequestListItem[] {
  const [rows, setRows] = useState<PullRequestListItem[]>([]);
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    let cancelled = false;
    getRepoPullRequests(repoId, { all: true })
      .then((res) => {
        if (!cancelled) setRows(res.pullRequests);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, signal]);
  return rows;
}

/** The workspace's open pull requests whose latest check settled, when `enabled`; `signal` re-reads. */
export function useWorkspacePullRequests(enabled: boolean, signal = 0): WorkspacePullRequestRow[] {
  const [rows, setRows] = useState<WorkspacePullRequestRow[]>([]);
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    let cancelled = false;
    getContextPullRequests()
      .then((res) => {
        if (!cancelled) setRows(res.pullRequests);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, signal]);
  return rows;
}

/** What a list's Pull request column and filter draw of one; every pull request record satisfies it. */
export type PullRequestMark = Pick<PullRequestRecord, 'repoFullName' | 'number' | 'title' | 'headRef'>;

/** The filter value: `<owner/repo>#<n>`, so two repositories' numbers never collide. */
export const pullRequestKey = (pr: Pick<PullRequestMark, 'repoFullName' | 'number'>): string =>
  `${pr.repoFullName}#${pr.number}`;

/** The filter's label: `#<n> <title>`, led by the repository when the workspace has several. */
export function pullRequestLabel(pr: PullRequestMark, manyRepositories: boolean): string {
  return `${manyRepositories ? `${pr.repoFullName} ` : ''}#${pr.number} ${pr.title}`.trim();
}

/** What the cell says on hover: the title and the head branch. */
export const pullRequestHover = (pr: PullRequestMark): string => `${pr.title} · ${pr.headRef}`;
