/**
 * GitHub integration page (enterprise). Install the App, see installations,
 * connect repos to the PR gate, toggle blocking, and unlink. Lives behind the
 * `github-gate` capability.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  GithubConnectStatusResponse,
  GithubRepoSummary,
} from '@truecourse/shared';
import { getJson, postJson, patchJson, delJson } from './api';

export default function GithubConnectPage() {
  const [status, setStatus] = useState<GithubConnectStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [repoFullName, setRepoFullName] = useState('');
  const [installationId, setInstallationId] = useState<string>('');
  const [defaultBranch, setDefaultBranch] = useState('main');

  // Stable identity (empty deps) so the mount effect runs exactly once; the
  // default-installation pick uses the functional setter to read latest state.
  const load = useCallback(() => {
    getJson<GithubConnectStatusResponse>('/api/ee/github/status')
      .then((s) => {
        setStatus(s);
        setInstallationId(
          (prev) => prev || String(s.installations[0]?.installationId ?? ''),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const connectRepo = (e: FormEvent) => {
    e.preventDefault();
    if (!repoFullName || !installationId) return;
    void run(() =>
      postJson('/api/ee/github/repos/link', {
        repoFullName: repoFullName.trim(),
        installationId: Number(installationId),
        defaultBranch: defaultBranch.trim() || 'main',
      }),
    ).then(() => setRepoFullName(''));
  };

  const toggleBlocking = (repo: GithubRepoSummary) =>
    void run(() =>
      patchJson('/api/ee/github/repos/config', {
        repoFullName: repo.repoFullName,
        blocking: !repo.blocking,
      }),
    );

  const unlink = (repo: GithubRepoSummary) =>
    void run(() =>
      delJson(
        `/api/ee/github/repos/link?repoFullName=${encodeURIComponent(repo.repoFullName)}`,
      ),
    );

  const saveNotify = (repo: GithubRepoSummary, value: string) => {
    const emails = value
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.join(',') === repo.notifyEmails.join(',')) return;
    void run(() =>
      patchJson('/api/ee/github/repos/config', {
        repoFullName: repo.repoFullName,
        notifyEmails: emails,
      }),
    );
  };

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">GitHub</h1>
        <p className="text-sm text-neutral-400">
          Connect repositories so TrueCourse runs as a gate on every pull
          request.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Installation</h2>
        {status && status.installations.length === 0 && (
          <p className="text-sm text-neutral-400">
            The GitHub App isn’t installed for this workspace yet.
          </p>
        )}
        {status?.installUrl && (
          <a
            href={status.installUrl}
            className="inline-flex items-center rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
          >
            Install GitHub App
          </a>
        )}
        {status && status.installations.length > 0 && (
          <ul className="text-sm text-neutral-300">
            {status.installations.map((i) => (
              <li key={i.installationId}>
                {i.accountLogin}{' '}
                <span className="text-neutral-500">({i.accountType})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Connected repositories</h2>
        {status && status.repos.length === 0 && (
          <p className="text-sm text-neutral-400">No repositories connected.</p>
        )}
        {status && status.repos.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1">Repository</th>
                <th className="py-1">Branch</th>
                <th className="py-1">Blocking</th>
                <th className="py-1">Notify (emails)</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {status.repos.map((r) => (
                <tr key={r.repoFullName} className="border-t border-neutral-800">
                  <td className="py-2 font-mono">{r.repoFullName}</td>
                  <td className="py-2">{r.defaultBranch}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggleBlocking(r)}
                      className="rounded px-2 py-0.5 text-xs ring-1 ring-neutral-700 hover:ring-neutral-500"
                    >
                      {r.blocking ? 'Blocking' : 'Advisory'}
                    </button>
                  </td>
                  <td className="py-2">
                    <input
                      // Re-mount when the persisted list changes so the input
                      // reflects what the server actually stored (after validation).
                      key={r.notifyEmails.join(',')}
                      defaultValue={r.notifyEmails.join(', ')}
                      onBlur={(e) => saveNotify(r, e.target.value)}
                      placeholder="a@x.com, b@y.com"
                      className="w-48 rounded bg-neutral-900 px-2 py-0.5 text-xs text-neutral-100 ring-1 ring-neutral-700"
                    />
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => unlink(r)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Unlink
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {status && status.installations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Connect a repository</h2>
          <form onSubmit={connectRepo} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-neutral-400">
              Repository (owner/name)
              <input
                value={repoFullName}
                onChange={(e) => setRepoFullName(e.target.value)}
                placeholder="acme/api"
                className="mt-1 rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100 ring-1 ring-neutral-700"
              />
            </label>
            <label className="flex flex-col text-xs text-neutral-400">
              Installation
              <select
                value={installationId}
                onChange={(e) => setInstallationId(e.target.value)}
                className="mt-1 rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100 ring-1 ring-neutral-700"
              >
                {status.installations.map((i) => (
                  <option key={i.installationId} value={i.installationId}>
                    {i.accountLogin}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-neutral-400">
              Default branch
              <input
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                className="mt-1 rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100 ring-1 ring-neutral-700"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
            >
              Connect
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
