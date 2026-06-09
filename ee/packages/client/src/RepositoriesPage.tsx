/**
 * Repositories — the single surface for repos under the PR gate. Merges what
 * used to be the workspace repo list + the standalone "GitHub" connect page:
 * list connected repos, toggle blocking, set notify emails, unlink, and connect
 * a new repo through a drawer (install the App → pick repo + branch + blocking).
 *
 * Behind the `github-gate` capability.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Settings } from 'lucide-react';
import type {
  GithubConnectStatusResponse,
  GithubRepoSummary,
  GithubInstallableRepo,
  GithubInstallationReposResponse,
} from '@truecourse/shared';
import { getJson, postJson } from './api';
import { Drawer } from './Drawer';
import { useJobs } from './jobs/JobsContext';

/** Job kinds — the wire values the gate worker emits. */
const REPO_BASELINE_KIND = 'repo.baseline';
const REPO_CONTRACTS_KIND = 'repo.contracts';

type RepoStatus = 'scanning' | 'updating' | 'needs-review' | 'ready' | 'failed' | 'not-scanned';

/**
 * Derive a repo's scan status from live + durable state (no extra server call):
 * an active baseline job means Scanning; an active contract-refresh job means
 * Updating (conflicts resolved, contracts regenerating); unresolved spec
 * conflicts mean Needs review (no contracts until resolved); a registered `slug`
 * with no conflicts is Ready; otherwise a recent failed-scan notification means
 * Failed, and a never-scanned repo is Not scanned.
 */
function deriveRepoStatus(
  repo: GithubRepoSummary,
  scanning: boolean,
  updating: boolean,
): RepoStatus {
  if (scanning) return 'scanning';
  if (updating) return 'updating';
  if (repo.openConflicts > 0) return 'needs-review';
  if (!repo.slug) return 'not-scanned';
  // Scanned + conflicts resolved: contracts present ⇒ Ready; absent ⇒ generation
  // failed or produced nothing (the gate has no contracts to check).
  return repo.hasContracts ? 'ready' : 'failed';
}

function RepoStatusBadge({ status }: { status: RepoStatus }) {
  if (status === 'scanning') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs text-sky-400 ring-1 ring-sky-500/30">
        <Loader2 className="h-3 w-3 animate-spin" />
        Scanning…
      </span>
    );
  }
  if (status === 'updating') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs text-sky-400 ring-1 ring-sky-500/30">
        <Loader2 className="h-3 w-3 animate-spin" />
        Updating…
      </span>
    );
  }
  if (status === 'needs-review') {
    return (
      <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 ring-1 ring-amber-500/30">
        Needs review
      </span>
    );
  }
  if (status === 'ready') {
    return (
      <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400 ring-1 ring-emerald-500/30">
        ● Ready
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400 ring-1 ring-red-500/30">
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
      Not scanned
    </span>
  );
}

export default function RepositoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<GithubConnectStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live scan state: an active baseline job → "Scanning"; survives a refresh
  // (activeJobs is seeded from the server), and flips to Ready on completion.
  const { activeJobFor } = useJobs();
  // Deep-link from Overview: `/repositories?connect=1` opens the drawer on arrival.
  const [connectOpen, setConnectOpen] = useState(() => searchParams.get('connect') === '1');

  // Strip the one-shot `connect` param so a refresh/back doesn't reopen the drawer.
  useEffect(() => {
    if (searchParams.get('connect') === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('connect');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = useCallback(() => {
    getJson<GithubConnectStatusResponse>('/api/ee/github/status')
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const repos = status?.repos ?? [];

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Repositories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Repositories connected to the TrueCourse PR gate.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConnectOpen(true)}
          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          + Connect repository
        </button>
      </header>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-md border border-border">
        {!status ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : repos.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No repositories connected yet — use{' '}
            <span className="font-medium text-foreground">+ Connect repository</span> above to
            add one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Repository</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Gate</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.repoFullName} className="border-t border-border">
                  <td className="px-4 py-2.5 font-mono">
                    {r.slug ? (
                      <Link to={`/repos/${r.slug}`} className="text-primary hover:underline">
                        {r.repoFullName}
                      </Link>
                    ) : (
                      <span className="text-foreground" title="Open after the first analysis">
                        {r.repoFullName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <RepoStatusBadge
                      status={deriveRepoStatus(
                        r,
                        Boolean(activeJobFor(REPO_BASELINE_KIND, `${REPO_BASELINE_KIND}:${r.repoFullName}`)),
                        Boolean(activeJobFor(REPO_CONTRACTS_KIND, `${REPO_CONTRACTS_KIND}:${r.repoFullName}`)),
                      )}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {/* Read-only status — edit the gate mode in the repo's Settings tab. */}
                    <span
                      title="Edit in the repo's Settings tab"
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs ring-1 ${
                        r.blocking
                          ? 'bg-red-500/10 text-red-400 ring-red-500/30'
                          : 'bg-amber-500/10 text-amber-400 ring-amber-500/30'
                      }`}
                    >
                      {r.blocking ? '● Blocking' : '○ Advisory'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.defaultBranch}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.slug && (
                      <Link
                        to={`/repos/${r.slug}?tab=settings`}
                        title="Repository settings"
                        aria-label={`${r.repoFullName} settings`}
                        className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Settings className="h-4 w-4" />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {connectOpen && (
        <ConnectDrawer
          status={status}
          onClose={() => setConnectOpen(false)}
          onConnected={() => {
            setConnectOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Right-side drawer: install the App (if needed), then link a repo. */
function ConnectDrawer({
  status,
  onClose,
  onConnected,
}: {
  status: GithubConnectStatusResponse | null;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [repoFullName, setRepoFullName] = useState('');
  const [installationId, setInstallationId] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [blocking, setBlocking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubInstallableRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);

  const installations = status?.installations ?? [];
  const hasInstall = installations.length > 0;

  useEffect(() => {
    if (!installationId && installations[0]) {
      setInstallationId(String(installations[0].installationId));
    }
  }, [installations, installationId]);

  // Load the repos this installation can access → the repo picker. Re-fetches
  // (and resets the selection) when the installation changes.
  useEffect(() => {
    if (!installationId) return;
    let cancelled = false;
    setReposLoading(true);
    setRepos([]);
    getJson<GithubInstallationReposResponse>(
      `/api/ee/github/installations/${installationId}/repos`,
    )
      .then((r) => {
        if (cancelled) return;
        setRepos(r.repos);
        const first = r.repos[0];
        if (first) {
          setRepoFullName(first.fullName);
          setDefaultBranch(first.defaultBranch);
        } else {
          setRepoFullName('');
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setReposLoading(false));
    return () => {
      cancelled = true;
    };
  }, [installationId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!repoFullName.trim() || !installationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postJson('/api/ee/github/repos/link', {
        repoFullName: repoFullName.trim(),
        installationId: Number(installationId),
        defaultBranch: defaultBranch.trim() || 'main',
        blocking,
      });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const field =
    'mt-1 w-full rounded-md bg-background px-2.5 py-1.5 text-sm text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <Drawer title="Connect a repository" onClose={onClose}>
        {error && (
          <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {!hasInstall ? (
          <div className="mt-6 space-y-3 text-sm text-muted-foreground">
            <p>
              Install the TrueCourse GitHub App on your account or organization, then come
              back here to connect a repository.
            </p>
            {status?.installUrl ? (
              <a
                href={status.installUrl}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Install GitHub App
              </a>
            ) : (
              <p className="text-xs text-amber-400">
                No workspace organization yet — create a workspace first.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-xs font-medium text-muted-foreground">
              Installation
              <select
                value={installationId}
                onChange={(e) => setInstallationId(e.target.value)}
                className={field}
              >
                {installations.map((i) => (
                  <option key={i.installationId} value={i.installationId}>
                    {i.accountLogin || `Installation #${i.installationId}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Repository
              {reposLoading ? (
                <div className={`${field} text-muted-foreground`}>Loading repositories…</div>
              ) : repos.length === 0 ? (
                <div className={`${field} text-muted-foreground`}>
                  No repositories accessible to this installation. Grant the App access on
                  GitHub, then reopen.
                </div>
              ) : (
                <select
                  autoFocus
                  value={repoFullName}
                  onChange={(e) => {
                    const repo = repos.find((r) => r.fullName === e.target.value);
                    setRepoFullName(e.target.value);
                    if (repo) setDefaultBranch(repo.defaultBranch);
                  }}
                  className={field}
                >
                  {repos.map((r) => (
                    <option key={r.fullName} value={r.fullName}>
                      {r.fullName}
                      {r.private ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Default branch
              <input
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                className={field}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={blocking}
                onChange={(e) => setBlocking(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Block merges on new drift (a required Check)
            </label>
            <button
              type="submit"
              disabled={busy || !repoFullName.trim()}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Connecting…' : 'Connect repository'}
            </button>
          </form>
        )}
    </Drawer>
  );
}
