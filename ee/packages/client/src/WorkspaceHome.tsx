/**
 * Enterprise Overview — the workspace governance dashboard. Leads with what the
 * PR gate is doing and what needs a human (failing gates, drift, never-analyzed
 * repos), then recent cross-repo gate activity. Replaces the OSS local-CLI
 * onboarding screen.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  WorkspaceOverviewResponse,
  WorkspaceRunsResponse,
  WorkspaceRunItem,
} from '@truecourse/shared';
import { formatRelativeTime } from '@truecourse/shared';
import { getJson } from './api';


const DOT: Record<WorkspaceRunItem['conclusion'], string> = {
  success: 'bg-emerald-500',
  failure: 'bg-red-500',
  neutral: 'bg-muted-foreground',
};

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

interface Attention {
  kind: 'blocked' | 'drift' | 'stale';
  text: string;
  to?: string;
  href?: string;
  when?: string;
}

export default function WorkspaceHome() {
  const [data, setData] = useState<WorkspaceOverviewResponse | null>(null);
  const [runs, setRuns] = useState<WorkspaceRunItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<WorkspaceOverviewResponse>('/api/ee/workspace/overview')
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    // github-gate is optional — swallow if the capability is off.
    getJson<WorkspaceRunsResponse>('/api/ee/github/runs?limit=12')
      .then((r) => !cancelled && setRuns(r.runs))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const s = data?.stats;
  const blocked = runs.filter((r) => r.conclusion === 'failure');

  // "Needs attention": blocking gate failures, then repos with open drift,
  // then never-analyzed repos.
  const attention: Attention[] = [
    ...blocked.map((r): Attention => ({
      kind: 'blocked',
      text: `${r.repoFullName} · PR #${r.prNumber} blocked — ${r.addedCount} new drift`,
      href: `https://github.com/${r.repoFullName}/pull/${r.prNumber}`,
      when: formatRelativeTime(r.createdAt),
    })),
    ...(data?.repos ?? [])
      .filter((r) => r.drift > 0)
      .map((r): Attention => ({ kind: 'drift', text: `${r.name} — ${r.drift} open drift`, to: `/repos/${r.id}` })),
    ...(data?.repos ?? [])
      .filter((r) => r.lastAnalyzed === null)
      .map((r): Attention => ({ kind: 'stale', text: `${r.name} — never scanned`, to: `/repos/${r.id}` })),
  ].slice(0, 6);

  const attnColor: Record<Attention['kind'], string> = {
    blocked: 'bg-red-500',
    drift: 'bg-amber-500',
    stale: 'bg-muted-foreground',
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{data?.organizationName ?? 'Overview'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {s ? `${s.repoCount} repositories under the gate` : 'Loading…'}
          </p>
        </div>
        <Link
          to="/repositories?connect=1"
          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          + Connect repository
        </Link>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Repositories" value={s?.repoCount ?? '—'} />
        <StatCard label="Open drift" value={s?.driftCount ?? '—'} />
        <StatCard label="Blocked PRs" value={blocked.length} />
        <StatCard label="Not scanned" value={s?.staleCount ?? '—'} sub={s ? `of ${s.repoCount} repos` : undefined} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Needs attention */}
        <section>
          <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>
          <div className="mt-2 overflow-hidden rounded-md border border-border">
            {attention.length === 0 ? (
              <div className="px-4 py-6 text-xs text-muted-foreground">
                {data ? 'All clear — nothing needs attention.' : 'Loading…'}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {attention.map((a, i) => {
                  const body = (
                    <span className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${attnColor[a.kind]}`} />
                      <span className="flex-1 truncate text-foreground">{a.text}</span>
                      {a.when && <span className="text-[11px] text-muted-foreground">{a.when}</span>}
                    </span>
                  );
                  return (
                    <li key={i} className="hover:bg-muted/50">
                      {a.href ? (
                        <a href={a.href} target="_blank" rel="noreferrer">{body}</a>
                      ) : a.to ? (
                        <Link to={a.to}>{body}</Link>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Recent gate activity */}
        <section>
          <h2 className="text-sm font-semibold text-foreground">Recent gate activity</h2>
          <div className="mt-2 overflow-hidden rounded-md border border-border">
            {runs.length === 0 ? (
              <div className="px-4 py-6 text-xs text-muted-foreground">
                No gate runs yet. Open a pull request on a connected repo.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {runs.map((r) => (
                  <li key={r.id}>
                    <a
                      href={`https://github.com/${r.repoFullName}/pull/${r.prNumber}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted/50"
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[r.conclusion]}`} />
                      <span className="flex-1 truncate text-foreground">
                        {r.repoFullName} <span className="text-muted-foreground">#{r.prNumber}</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        +{r.addedCount}/-{r.resolvedCount} · {formatRelativeTime(r.createdAt)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Repositories (compact) */}
      <h2 className="mt-8 text-sm font-semibold text-foreground">Repositories</h2>
      <div className="mt-2 overflow-hidden rounded-md border border-border">
        {!data ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">Loading…</div>
        ) : data.repos.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            No repositories yet.{' '}
            <Link to="/repositories" className="text-primary hover:underline">
              Connect one
            </Link>
            .
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.repos.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/repos/${r.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/50"
                >
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{r.violations} viol</span>
                    <span>{r.drift ? `${r.drift} drift` : '—'}</span>
                    <span>{formatRelativeTime(r.lastAnalyzed)}</span>
                    <span aria-hidden>→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
