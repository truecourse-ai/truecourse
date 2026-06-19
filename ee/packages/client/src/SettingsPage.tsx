/**
 * Settings hub — one place for workspace administration. Sub-tabs reuse the
 * existing pages: Members & SSO (WorkspacePage), Models (ModelsPage), and a
 * GitHub App section for installation management (per-repo gate config lives on
 * the Repositories page, not here).
 */

import { useEffect, useState } from 'react';
import type { GithubConnectStatusResponse } from '@truecourse/shared';
import { getJson } from './api';
import WorkspacePage from './WorkspacePage';
import ModelsPage from './ModelsPage';
import IntegrationsPage from './IntegrationsPage';

type TabId = 'members' | 'models' | 'integrations' | 'github';

const TABS: { id: TabId; label: string }[] = [
  { id: 'members', label: 'Members & SSO' },
  { id: 'models', label: 'Models' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'github', label: 'GitHub App' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>('members');

  return (
    <div>
      <div className="border-b border-border px-8 pt-8">
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <nav className="mt-4 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Reuse the existing pages as the tab bodies (they bring their own
          padded container). */}
      {tab === 'members' && <WorkspacePage />}
      {tab === 'models' && <ModelsPage />}
      {tab === 'integrations' && <IntegrationsPage />}
      {tab === 'github' && <GithubAppSettings />}
    </div>
  );
}

/** Installation management — install/extend the App; per-repo config is on Repositories. */
function GithubAppSettings() {
  const [status, setStatus] = useState<GithubConnectStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<GithubConnectStatusResponse>('/api/ee/github/status')
      .then((s) => !cancelled && setStatus(s))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h2 className="text-sm font-semibold text-foreground">GitHub App</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Installations of the TrueCourse GitHub App for this workspace. Connect or
        configure individual repositories on the Repositories page.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-md border border-border">
        {!status ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">Loading…</div>
        ) : status.installations.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            The GitHub App isn’t installed for this workspace yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {status.installations.map((i) => (
              <li
                key={i.installationId}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="text-foreground">
                  {i.accountLogin || `Installation #${i.installationId}`}
                  {i.accountType && (
                    <span className="text-muted-foreground"> ({i.accountType})</span>
                  )}
                </span>
                <a
                  href={`https://github.com/settings/installations/${i.installationId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Manage on GitHub →
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {status?.installUrl && (
        <a
          href={status.installUrl}
          className="mt-4 inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {status.installations.length > 0 ? 'Add another installation' : 'Install GitHub App'}
        </a>
      )}
    </div>
  );
}
