/**
 * Integrations settings (enterprise). A LIST of knowledge connectors; each row
 * has a "Configure" button that opens the shared right-side `Drawer` (the same
 * component used to connect a repository) with a field-metadata-driven credential
 * form + a Test button. Adding a connector needs no change here — the server
 * describes its fields. Secret fields are encrypted server-side and shown masked.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  IntegrationConnectorStatus,
  IntegrationsResponse,
  JobView,
} from '@truecourse/shared';
import { getJson, postJson, delJson } from './api';
import { Drawer } from './Drawer';
import { useJobs } from './jobs/JobsContext';

/** Mirrors the server's job type + single-flight key for `knowledge.sync`. */
const SYNC_TYPE = 'knowledge.sync';
const syncKey = (kind: string) => `${SYNC_TYPE}:${kind}`;

const inputCls =
  'w-full rounded bg-background px-3 py-1.5 text-sm text-foreground ring-1 ring-border placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary';

function isConnected(c: IntegrationConnectorStatus): boolean {
  const conn = c.connection;
  if (!conn) return false;
  const secret = c.fields.find((f) => f.secret);
  const hasSecret = !secret || conn.hasToken;
  const hasConfig = c.fields.filter((f) => !f.secret).every((f) => conn.config[f.key]);
  return hasSecret && hasConfig;
}

export default function IntegrationsPage() {
  const [connectors, setConnectors] = useState<IntegrationConnectorStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  // Local "POST in flight" only; the persistent "Syncing…" state is server-derived
  // (from the active job) so it survives a page refresh — see `activeJobFor`.
  const [submitting, setSubmitting] = useState<string | null>(null);
  const { activeJobFor } = useJobs();

  const load = useCallback(() => {
    getJson<IntegrationsResponse>('/api/ee/integrations')
      .then((r) => setConnectors(r.connectors))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const active = useMemo(
    () => connectors?.find((c) => c.kind === configuring) ?? null,
    [connectors, configuring],
  );

  // Quick sync from the row (connected connectors only). The work now runs in a
  // background job: POST enqueues it (202) and returns immediately — progress +
  // the result arrive over SSE (live toast + the notifications feed). A concurrent
  // sync is rejected by the server (409); we surface that message.
  const syncNow = async (kind: string) => {
    setSubmitting(kind);
    setError(null);
    try {
      // Enqueues a background job (202) — progress + the result arrive via the
      // SSE-driven toast + notifications feed, so no inline "started" banner.
      await postJson<{ jobId: string }>('/api/ee/knowledge/sync', { kind });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect a tool as a workspace Knowledge source. Credentials are
          encrypted at rest and never shown again.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400 break-words">
          {error}
        </div>
      )}

      <div className="divide-y divide-border overflow-hidden rounded border border-border">
        {!connectors ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          connectors.map((c) => (
            <div key={c.kind} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium text-foreground">{c.name}</div>
                <div className="truncate text-sm text-muted-foreground">{c.description}</div>
                <div
                  className={`mt-0.5 text-xs ${
                    isConnected(c) ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                  }`}
                >
                  {isConnected(c) ? 'Connected' : 'Not connected'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isConnected(c) && <SyncButton kind={c.kind} onSync={syncNow} submitting={submitting === c.kind} job={activeJobFor(SYNC_TYPE, syncKey(c.kind))} />}
                <button
                  type="button"
                  onClick={() => setConfiguring(c.kind)}
                  className="rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40"
                >
                  Configure
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {active && (
        <ConnectorDrawer
          connector={active}
          onClose={() => setConfiguring(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/**
 * The connector's sync button. Disabled + "Syncing…" whenever there's an active
 * job for this connector (server-derived, so it stays "Syncing…" across a page
 * refresh) or while the enqueue POST is in flight. Shows live progress when known.
 */
function SyncButton({
  kind,
  onSync,
  submitting,
  job,
}: {
  kind: string;
  onSync: (kind: string) => void;
  submitting: boolean;
  job: JobView | undefined;
}) {
  const syncing = !!job || submitting;
  const label = job && job.progress.total > 0
    ? `Syncing ${job.progress.current}/${job.progress.total}`
    : syncing
      ? 'Syncing…'
      : 'Sync now';
  return (
    <button
      type="button"
      onClick={() => onSync(kind)}
      disabled={syncing}
      className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function Banner({ tone, children }: { tone: 'error' | 'ok'; children: ReactNode }) {
  const cls =
    tone === 'error'
      ? 'border-red-500/40 bg-red-500/10 text-red-400'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400';
  return <div className={`mt-4 rounded border px-3 py-2 text-sm break-words ${cls}`}>{children}</div>;
}

function ConnectorDrawer({
  connector,
  onClose,
  onChanged,
}: {
  connector: IntegrationConnectorStatus;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Pre-fill non-secret fields from the stored config; secret stays blank.
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...(connector.connection?.config ?? {}),
  }));
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const conn = connector.connection;
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const payload = { kind: connector.kind, values };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const test = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      await postJson('/api/ee/integrations/test', payload);
      setNotice('Connection OK.');
    } catch (e) {
      fail(e);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await postJson('/api/ee/integrations', payload);
      setNotice('Connection saved.');
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await delJson(`/api/ee/integrations/${connector.kind}`);
      onChanged();
      onClose();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };

  return (
    <Drawer title={`Configure ${connector.name}`} onClose={onClose}>
      <p className="mt-2 text-sm text-muted-foreground">{connector.description}</p>

      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}

      <div className="mt-5 space-y-4">
        {connector.fields.map((f) => (
          <label key={f.key} className="block space-y-1">
            <span className="text-sm text-muted-foreground">{f.label}</span>
            <input
              type={f.type}
              value={values[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={
                f.secret && conn?.hasToken
                  ? `${conn.tokenMask ?? '••••'} — leave blank to keep`
                  : f.placeholder
              }
              autoComplete={f.secret ? 'off' : undefined}
              className={inputCls}
            />
          </label>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={test}
          disabled={testing}
          className="rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {/* "Sync now" lives in the connector row on the page; the drawer is for
            configuration only. */}
        {conn?.hasToken && (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="ml-auto rounded px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-50"
          >
            Disconnect
          </button>
        )}
      </div>
    </Drawer>
  );
}
