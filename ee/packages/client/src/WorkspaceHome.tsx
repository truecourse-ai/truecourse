/**
 * Enterprise home — the workspace dashboard. Replaces the OSS local-CLI
 * onboarding screen with org stats and a list of repositories.
 *
 * Repo data is the locally-analyzed set today; once GitHub connection
 * lands it becomes the GitHub-connected repos and "Connect repository"
 * starts the install flow (stubbed for now).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkspaceOverviewResponse } from '@truecourse/shared';
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

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function WorkspaceHome() {
  const [data, setData] = useState<WorkspaceOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSoon, setShowSoon] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJson<WorkspaceOverviewResponse>('/api/ee/workspace/overview')
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const s = data?.stats;
  const sev = s?.severity;

  return (
    <div className="mx-auto max-w-5xl p-8">
      {/* Title row */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {data?.organizationName ?? 'Workspace'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {s ? `${s.repoCount} repositories` : 'Loading…'}
          </p>
        </div>
        <div className="text-right">
          <button
            onClick={() => setShowSoon(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            + Connect repository
          </button>
          {showSoon && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              GitHub connection is coming soon.
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {error}
        </div>
      )}

      {/* Stat cards — workspace code-health at a glance. Org/admin info
          (members, SSO) lives on the Workspace page, not here. */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Repositories" value={s?.repoCount ?? '—'} />
        <StatCard
          label="Open violations"
          value={s?.violationCount ?? '—'}
          sub={
            sev
              ? `${sev.critical} crit · ${sev.high} high · ${sev.medium} med`
              : undefined
          }
        />
        <StatCard label="BL drift" value={s?.driftCount ?? '—'} />
        <StatCard
          label="Needs analysis"
          value={s?.staleCount ?? '—'}
          sub={s ? `of ${s.repoCount} repos` : undefined}
        />
      </div>

      {/* Repositories */}
      <h2 className="mt-8 text-sm font-semibold text-foreground">Repositories</h2>
      <div className="mt-2 overflow-hidden rounded-md border border-border">
        {!data ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">Loading…</div>
        ) : data.repos.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            No repositories yet. Connect a GitHub repository to get started.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.repos.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/repos/${r.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
                >
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{r.violations} viol</span>
                    <span>{r.drift ? `${r.drift} drift` : '—'}</span>
                    <span>{timeAgo(r.lastAnalyzed)}</span>
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
