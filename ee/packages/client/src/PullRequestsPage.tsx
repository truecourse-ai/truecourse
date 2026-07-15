/**
 * Pull requests — the workspace-wide gate-run feed. Every connected repo's
 * recent gate runs, one row per PR, each linking to its GitHub PR. GitHub-style
 * Open/Closed filter (Open by default). The cross-repo companion to a repo's own
 * "Pull requests" tab. Behind the `github-gate` capability.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkspaceRunItem } from '@truecourse/shared';
import { formatRelativeTime } from '@truecourse/shared';
import { getJson } from './api';

type PrState = 'open' | 'closed' | 'merged';

/**
 * The feed row: a workspace gate run plus its PR's tracked state. `prState` is
 * null for PRs predating close-tracking — treated as open (they were never
 * observed to close).
 */
interface PrFeedItem extends WorkspaceRunItem {
  prState: PrState | null;
  title: string | null;
}

interface PrFeedResponse {
  runs: PrFeedItem[];
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

/** null prState (pre-tracking history) reads as open. */
const isOpenState = (s: PrState | null): boolean => s === 'open' || s === null;

export default function PullRequestsPage() {
  const [runs, setRuns] = useState<PrFeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'closed'>('open');

  useEffect(() => {
    let cancelled = false;
    getJson<PrFeedResponse>('/api/ee/github/runs?limit=50')
      .then((r) => !cancelled && setRuns(r.runs))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const { open, closed } = useMemo(() => {
    const o: PrFeedItem[] = [];
    const c: PrFeedItem[] = [];
    for (const r of runs ?? []) (isOpenState(r.prState) ? o : c).push(r);
    return { open: o, closed: c };
  }, [runs]);

  const visible = filter === 'open' ? open : closed;

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

      <div className="mt-6 inline-flex rounded-md border border-border p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setFilter('open')}
          className={`rounded px-3 py-1 font-medium transition-colors ${
            filter === 'open'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Open <span className="tabular-nums">{open.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setFilter('closed')}
          className={`rounded px-3 py-1 font-medium transition-colors ${
            filter === 'closed'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Closed <span className="tabular-nums">{closed.length}</span>
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-md border border-border">
        {!runs ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {filter === 'open'
              ? 'No open pull requests. Open one on a connected repository.'
              : 'No closed pull requests yet.'}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((r) => {
              const rowClass = 'flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50';
              const body = (
                <>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[r.conclusion]}`} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-foreground">{r.repoFullName}</span>
                    <span className="text-muted-foreground"> #{r.prNumber}</span>
                    {r.title && <span className="text-muted-foreground"> · {r.title}</span>}
                  </span>
                  {r.prState === 'merged' && (
                    <span className="shrink-0 rounded-full bg-purple-500/10 px-2 py-0.5 text-[11px] text-purple-400 ring-1 ring-purple-500/30">
                      merged
                    </span>
                  )}
                  {r.prState === 'closed' && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border">
                      closed
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    +{r.addedCount}/-{r.resolvedCount}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1 ${BADGE[r.conclusion]}`}
                  >
                    {LABEL[r.conclusion]}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatRelativeTime(r.createdAt)}
                  </span>
                </>
              );
              return (
                <li key={`${r.repoFullName}#${r.id}`}>
                  {r.slug ? (
                    // Internal: the row opens this PR on the Code Quality
                    // Analytics tab; the trailing "Guard" link opens its Guard
                    // runs instead. Sibling anchors (not nested) — the hover
                    // wash moves to the shared wrapper.
                    <div className="flex items-center hover:bg-muted/50">
                      <Link
                        to={`/repos/${r.slug}?section=codequality&tab=analytics&pr=${r.prNumber}`}
                        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-sm"
                      >
                        {body}
                      </Link>
                      <Link
                        to={`/repos/${r.slug}?section=guard&tab=guarddrifts&pr=${r.prNumber}`}
                        title="Open this PR's Guard runs"
                        className="inline-flex shrink-0 items-center self-stretch border-l border-border px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Guard
                      </Link>
                    </div>
                  ) : (
                    // Unregistered repo (no dashboard page yet) → fall back to GitHub.
                    <a
                      href={`https://github.com/${r.repoFullName}/pull/${r.prNumber}`}
                      target="_blank"
                      rel="noreferrer"
                      className={rowClass}
                    >
                      {body}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
