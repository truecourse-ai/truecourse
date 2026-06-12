/**
 * Workspace — the enterprise-only page. Shows the org's SSO connection
 * status and members, both sourced from WorkOS via the protected
 * /api/ee/workspace endpoints.
 */

import { useEffect, useState } from 'react';
import type {
  SsoStatusResponse,
  WorkspaceMembersResponse,
} from '@truecourse/shared';
import { getJson } from './api';

export default function WorkspacePage() {
  const [sso, setSso] = useState<SsoStatusResponse | null>(null);
  const [members, setMembers] = useState<WorkspaceMembersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getJson<SsoStatusResponse>('/api/ee/workspace/sso-status'),
      getJson<WorkspaceMembersResponse>('/api/ee/workspace/members'),
    ])
      .then(([s, m]) => {
        if (cancelled) return;
        setSso(s);
        setMembers(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold text-foreground">Workspace</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enterprise SSO and members, synced from WorkOS.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {error}
        </div>
      )}

      {/* SSO connection status */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-foreground">
          Single sign-on
        </h2>
        {sso === null ? (
          <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
        ) : sso.configured ? (
          <ul className="mt-2 space-y-2">
            {sso.connections.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {c.name}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {c.type}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    c.state === 'active'
                      ? 'bg-emerald-500/15 text-emerald-500'
                      : 'bg-amber-500/15 text-amber-500'
                  }`}
                >
                  {c.state}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            No SSO connection configured for this organization yet.
          </p>
        )}
      </section>

      {/* Members */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-foreground">Members</h2>
        {members === null ? (
          <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
        ) : members.members.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No members found.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {members.members.map((m) => {
              const name =
                [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="text-sm text-foreground">{name}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.email}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
