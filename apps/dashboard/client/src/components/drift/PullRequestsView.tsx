/**
 * Pull requests (enterprise) — the PR gate's runs for this repo, shown as a
 * repo-detail tab (BL Drift section, gated on the `github-gate` capability).
 * Each row is one gate run: pass/fail/neutral, the PR, and drift added/resolved.
 * Data comes from the protected connect router; `repoFullName` is the repo's
 * registered `owner/repo` identity.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, CircleDashed, GitPullRequest } from 'lucide-react';
import type { GithubRunsResponse, GithubRunSummary } from '@truecourse/shared';
import { getServerUrl } from '@/lib/server-url';

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Conclusion({ c }: { c: GithubRunSummary['conclusion'] }) {
  if (c === 'success')
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-500">
        <CheckCircle2 className="h-4 w-4" /> Passed
      </span>
    );
  if (c === 'failure')
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <XCircle className="h-4 w-4" /> Blocked
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <CircleDashed className="h-4 w-4" /> Neutral
    </span>
  );
}

export function PullRequestsView({ repoFullName }: { repoFullName?: string }) {
  const [runs, setRuns] = useState<GithubRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!repoFullName || !repoFullName.includes('/')) {
      setRuns([]);
      return;
    }
    fetch(`${getServerUrl()}/api/ee/github/repos/${repoFullName}/runs`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then((d: GithubRunsResponse) => !cancelled && setRuns(d.runs))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [repoFullName]);

  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-auto p-8">
      <div className="flex items-center gap-2">
        <GitPullRequest className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Pull requests</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Drift-gate runs the TrueCourse GitHub App posted on this repository's pull requests.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded-md border border-border">
        {runs === null ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No gate runs yet. Open a pull request against this repo to see the gate in action.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center gap-4 px-4 py-3 text-sm">
                <a
                  href={`https://github.com/${repoFullName}/pull/${r.prNumber}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-foreground hover:underline"
                >
                  #{r.prNumber}
                </a>
                <span className="w-28">
                  <Conclusion c={r.conclusion} />
                </span>
                <span className="flex-1 text-xs text-muted-foreground">
                  +{r.addedCount} drift · −{r.resolvedCount} resolved
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {r.headSha.slice(0, 7)}
                </span>
                <span className="text-[11px] text-muted-foreground">{timeAgo(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
