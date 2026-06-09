/**
 * Per-repo gate settings (EE) — the repo console's Settings tab. Sets the
 * blocking mode, notify emails, and per-type notification toggles for one
 * connected repo, all through `PATCH /api/ee/github/repos/config`.
 *
 * Lives on the OSS side (rendered inside RepoPage) so the ee client package
 * needn't know about repo routing; it reaches the gate API by convention.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type {
  GithubConnectStatusResponse,
  GithubNotificationPrefs,
  GithubRepoSummary,
} from '@truecourse/shared';
import { getServerUrl } from '@/lib/server-url';

const NOTIFICATIONS: {
  key: keyof GithubNotificationPrefs;
  label: string;
  desc: string;
}[] = [
  { key: 'gateFailure', label: 'Gate failures', desc: 'A pull request’s gate blocks on new drift.' },
  { key: 'scanOffer', label: 'Spec-change re-scans', desc: 'Spec documents changed in a PR — offer to re-scan.' },
  { key: 'inferResult', label: 'Undocumented decisions', desc: 'Inference captured new decisions on a PR.' },
  { key: 'conflicts', label: 'Spec conflicts', desc: 'Conflicts need resolving before contracts can regenerate.' },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getServerUrl()}${path}`, { credentials: 'include', ...init });
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* keep status message */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function Toggle({
  on,
  disabled,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function RepoSettings({ repoFullName }: { repoFullName?: string }) {
  const navigate = useNavigate();
  const [repo, setRepo] = useState<GithubRepoSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);

  const load = useCallback(async () => {
    if (!repoFullName) {
      setLoaded(true);
      return;
    }
    try {
      const s = await api<GithubConnectStatusResponse>('/api/ee/github/status');
      const r = s.repos.find((x) => x.repoFullName === repoFullName) ?? null;
      setRepo(r);
      if (r) setEmails(r.notifyEmails.join(', '));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [repoFullName]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    if (!repo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/ee/github/repos/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName: repo.repoFullName, ...body }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!repo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        `/api/ee/github/repos/link?repoFullName=${encodeURIComponent(repo.repoFullName)}`,
        { method: 'DELETE' },
      );
      navigate('/repositories'); // the repo's gone from the gate — back to the list
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">
        This repository isn’t connected to the PR gate{repoFullName ? ` (${repoFullName})` : ''}.
        Connect it from the Repositories page to configure gate settings.
      </div>
    );
  }

  const emailsDirty = emails.trim() !== repo.notifyEmails.join(', ');

  return (
    <div className="mx-auto max-w-2xl space-y-8 overflow-auto p-8">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground font-mono">{repo.repoFullName}</p>
      </header>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Gate mode */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Gate</h2>
        <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
          <div>
            <div className="text-sm font-medium text-foreground">Block merges on new drift</div>
            <div className="text-xs text-muted-foreground">
              {repo.blocking
                ? 'New drift fails a required Check.'
                : 'Advisory only — the Check reports but never blocks.'}
            </div>
          </div>
          <Toggle on={repo.blocking} disabled={busy} onClick={() => patch({ blocking: !repo.blocking })} />
        </div>
      </section>

      {/* Notify emails */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Notification emails</h2>
        <p className="text-xs text-muted-foreground">
          Comma-separated addresses that receive the gate emails below.
        </p>
        <div className="flex gap-2">
          <input
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="a@acme.com, b@acme.com"
            className="flex-1 rounded-md bg-background px-3 py-1.5 text-sm text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            disabled={busy || !emailsDirty}
            onClick={() =>
              patch({
                notifyEmails: emails.split(',').map((e) => e.trim()).filter(Boolean),
              })
            }
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </section>

      {/* Per-type notification toggles */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
        <p className="text-xs text-muted-foreground">
          Which gate emails this repo sends to the addresses above.
        </p>
        <div className="divide-y divide-border rounded-md border border-border">
          {NOTIFICATIONS.map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between px-4 py-3">
              <div className="pr-4">
                <div className="text-sm font-medium text-foreground">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
              <Toggle
                on={repo.notifications[key]}
                disabled={busy}
                onClick={() => patch({ notifications: { [key]: !repo.notifications[key] } })}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Danger zone — disconnect this repo from the gate. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Danger zone</h2>
        <div className="flex items-center justify-between rounded-md border border-red-500/30 px-4 py-3">
          <div className="pr-4">
            <div className="text-sm font-medium text-foreground">Disconnect repository</div>
            <div className="text-xs text-muted-foreground">
              The PR gate stops running on {repo.repoFullName}. Reconnect it any time from the
              Repositories page.
            </div>
          </div>
          {confirmingUnlink ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void unlink()}
                className="rounded-md bg-red-500/90 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                Confirm disconnect
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingUnlink(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingUnlink(true)}
              className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-red-400 ring-1 ring-red-500/40 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              Disconnect
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
