/**
 * Pull requests — the workspace-wide gate-run feed. Every connected repo's
 * recent gate runs, newest-first, each linking to its GitHub PR. The cross-repo
 * companion to a repo's own "Pull requests" tab. Behind the `github-gate`
 * capability.
 */

import { useEffect, useState } from 'react';
import type { WorkspaceRunItem, WorkspaceRunsResponse } from '@truecourse/shared';
import { getJson } from './api';

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const DOT: Record<WorkspaceRunItem['conclusion'], string> = {
  success: 'bg-emerald-500',
  failure: 'bg-red-500',
  neutral: 'bg-muted-foreground',
};

const BADGE: Record<WorkspaceRunItem['conclusion'], string> = {
  success: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30',
  failure: 'bg-red-500/10 text-red-400 ring-red-500/30',
  neutral: 'bg-muted text-muted-foreground ring-border',
};

const LABEL: Record<WorkspaceRunItem['conclusion'], string> = {
  success: 'Passed',
  failure: 'Blocked',
  neutral: 'Neutral',
};

export default function PullRequestsPage() {
  const [runs, setRuns] = useState<WorkspaceRunItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<WorkspaceRunsResponse>('/api/ee/github/runs?limit=50')
      .then((r) => !cancelled && setRuns(r.runs))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Pull requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Recent gate runs across every connected repository.
        </p>
      </header>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-md border border-border">
        {!runs ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No gate runs yet. Open a pull request on a connected repository.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={`${r.repoFullName}#${r.id}`}>
                <a
                  href={`https://github.com/${r.repoFullName}/pull/${r.prNumber}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[r.conclusion]}`} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-foreground">{r.repoFullName}</span>
                    <span className="text-muted-foreground"> #{r.prNumber}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    +{r.addedCount}/-{r.resolvedCount}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1 ${BADGE[r.conclusion]}`}
                  >
                    {LABEL[r.conclusion]}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {timeAgo(r.createdAt)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
