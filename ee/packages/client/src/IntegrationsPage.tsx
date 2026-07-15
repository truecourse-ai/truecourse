/**
 * Integrations settings (enterprise). A LIST of knowledge connectors; each row
 * has a "Configure" button that opens the shared right-side `Drawer` (the same
 * component used to connect a repository) with a field-metadata-driven credential
 * form + a Test button. Adding a connector needs no change here — the server
 * describes its fields. Secret fields are encrypted server-side and shown masked.
 *
 * A connected row has two explicit buttons:
 *   - "Sync now"  → dispatches the pre-flight sweep (`knowledge.estimate`). While
 *     it runs the row shows "Syncing…"; when it settles the row reloads so a newly
 *     found `pending` record (and its Process button) appears. The outcome toast
 *     arrives on its own via the org-wide notification feed.
 *   - "Process"   → renders only while `connection.pending` exists, with the delta
 *     summary shown beside it. Click opens the OSS `LlmEstimateModal` from the
 *     stored estimate; Confirm dispatches the consolidate job (`knowledge.sync`).
 *     A stored estimate with no LLM stages dispatches directly (no modal).
 * Busy state is derived from the org's active jobs (`activeJobFor`), so it is
 * refresh-safe and visible to every user in the workspace.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  IntegrationConnectorStatus,
  IntegrationPendingEstimate,
  IntegrationPendingView,
  IntegrationsResponse,
} from '@truecourse/shared';
import { getJson, postJson, delJson } from './api';
import { Drawer } from './Drawer';
import { useJobs } from './jobs/JobsContext';
import { LlmEstimateModal } from '@/components/spec/LlmEstimateModal';

/** Stage 2: the consolidate job. Processing is workspace-scoped (single-flight
 *  `knowledge.sync:<org>`), so "Processing…" is derived from ANY active sync job. */
const SYNC_TYPE = 'knowledge.sync';
/** Stage 1: the pre-flight sweep job — its own type + per-kind single-flight key. */
const ESTIMATE_TYPE = 'knowledge.estimate';
const estimateKey = (kind: string) => `${ESTIMATE_TYPE}:${kind}`;

/** One source folded into the combined Process run. */
interface PendingSource {
  kind: string;
  name: string;
  pending: IntegrationPendingView;
}

/**
 * The COMBINED processing estimate — processing is workspace-scoped, so a single
 * union job consolidates every connected source. Fold every connector's stored
 * pending into one estimate: stages merged by stage (calls/tokens/cost summed),
 * total cost summed, `costPartial` OR-ed. The per-source delta lines label which
 * sources contribute (only when more than one does).
 */
function combinePendings(connectors: IntegrationConnectorStatus[]): {
  estimate: IntegrationPendingEstimate;
  sources: { name: string; summary: string }[];
} {
  const pendings: PendingSource[] = connectors
    .filter((c) => c.connection?.pending)
    .map((c) => ({ kind: c.kind, name: c.name, pending: c.connection!.pending! }));

  const stageMap = new Map<
    string,
    { stage: string; label?: string; model: string; calls: number; estimatedTokens: number; cost: number; hasCost: boolean; low: number; high: number }
  >();
  let totalTokens = 0;
  let cost = 0;
  let hasCost = false;
  let costPartial = false;

  for (const { pending } of pendings) {
    const e = pending.estimate;
    totalTokens += e.totalEstimatedTokens ?? 0;
    if (e.estimatedCostUsd != null) {
      cost += e.estimatedCostUsd;
      hasCost = true;
    }
    if (e.costPartial) costPartial = true;
    for (const s of e.stages ?? []) {
      const agg =
        stageMap.get(s.stage) ??
        { stage: s.stage, label: s.label, model: s.model, calls: 0, estimatedTokens: 0, cost: 0, hasCost: false, low: 0, high: 0 };
      agg.calls += s.calls;
      agg.estimatedTokens += s.estimatedTokens;
      if (s.estimatedCostUsd != null) {
        agg.cost += s.estimatedCostUsd;
        agg.hasCost = true;
      }
      agg.low += s.callsRange?.low ?? s.calls;
      agg.high += s.callsRange?.high ?? s.calls;
      stageMap.set(s.stage, agg);
    }
  }

  const stages = [...stageMap.values()].map((a) => ({
    stage: a.stage,
    label: a.label,
    model: a.model,
    calls: a.calls,
    estimatedTokens: a.estimatedTokens,
    estimatedCostUsd: a.hasCost ? a.cost : undefined,
    callsRange: a.high !== a.low ? { low: a.low, high: a.high } : undefined,
  }));

  const estimate: IntegrationPendingEstimate = {
    totalEstimatedTokens: totalTokens,
    tiers: [],
    stages,
    subjectLabel: pendings.length === 1 ? pendings[0].pending.estimate.subjectLabel : `${pendings.length} sources`,
    estimatedCostUsd: hasCost ? cost : undefined,
    costPartial,
  };
  // Per-source lines only when more than one source contributes (a lone source's
  // delta already reads on the row + as the subject line).
  const sources =
    pendings.length > 1 ? pendings.map((p) => ({ name: p.name, summary: pendingSummary(p.pending) })) : [];
  return { estimate, sources };
}

const inputCls =
  'w-full rounded bg-background px-3 py-1.5 text-sm text-foreground ring-1 ring-border placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary';

function isConnected(c: IntegrationConnectorStatus): boolean {
  const conn = c.connection;
  if (!conn) return false;
  const secret = c.fields.find((f) => f.secret);
  const hasSecret = !secret || conn.hasToken;
  // Optional fields (e.g. Jira's JQL filter) never block "Connected".
  const hasConfig = c.fields.filter((f) => !f.secret && !f.optional).every((f) => conn.config[f.key]);
  return hasSecret && hasConfig;
}

/** Delta-only summary beside Process, e.g. "3 new · 2 changed of 40 docs". No cost —
 *  the ceiling cost is shown in the Process confirm modal, not on the row. */
function pendingSummary(p: IntegrationPendingView): string {
  if (p.estimate.subjectLabel) return p.estimate.subjectLabel;
  const { new: added, changed, removed } = p.delta;
  const parts: string[] = [];
  if (added) parts.push(`${added} new`);
  if (changed) parts.push(`${changed} changed`);
  if (removed) parts.push(`${removed} removed`);
  return parts.join(' · ');
}

export default function IntegrationsPage() {
  const [connectors, setConnectors] = useState<IntegrationConnectorStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  // Local "POST in flight" guard (prevents a double-dispatch before the job shows
  // up in activeJobs). The persistent "Syncing…"/"Processing…" state is server-
  // derived (from the active job) so it survives a refresh — see `activeJobFor`.
  const [submitting, setSubmitting] = useState<string | null>(null);
  // The kind whose Process button opened the combined confirm modal (a staged
  // estimate only); the dialog itself sums EVERY connector's pending.
  const [confirming, setConfirming] = useState<string | null>(null);
  const { activeJobFor, activeJobs, onJobSettled } = useJobs();

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

  // The COMBINED processing estimate (every connector's pending folded into one
  // workspace run) + its per-source delta lines. Recomputed as the list reloads.
  const combined = useMemo(() => combinePendings(connectors ?? []), [connectors]);
  // Processing is workspace-scoped: ANY active sync job means the whole workspace
  // is processing, so every row shows "Processing…".
  const anyProcessing = useMemo(() => activeJobs.some((j) => j.type === SYNC_TYPE), [activeJobs]);

  // Stage 1: "Sync now" dispatches the pre-flight sweep (`knowledge.estimate`, 202).
  // Progress rides the stepped popup; on completion a toast lands and the sweep
  // persists/clears the `pending` record server-side. A concurrent estimate/sync is
  // rejected by the server (409); we surface it.
  const dispatchEstimate = useCallback(async (kind: string) => {
    setSubmitting(kind);
    setError(null);
    try {
      await postJson<{ jobId: string }>('/api/ee/knowledge/estimate', { kind });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(null);
    }
  }, []);

  // Stage 2: the consolidate job (`knowledge.sync`, 202) — dispatched on Confirm in
  // the estimate modal, or directly for a no-stage (free) estimate. On success the
  // job clears the `pending` record. A concurrent sync is rejected (409); we surface it.
  const dispatchSync = useCallback(async (kind: string) => {
    setSubmitting(kind);
    setError(null);
    try {
      await postJson<{ jobId: string }>('/api/ee/knowledge/sync', { kind });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(null);
    }
  }, []);

  // Process click (any row → the same workspace run): a staged COMBINED estimate
  // opens the confirm modal (instant, from the stored estimates — no re-sweep); a
  // no-stage combined estimate is free work, so the explicit click is consent
  // enough and it dispatches directly.
  const onProcess = useCallback(
    (kind: string) => {
      if (combined.estimate.stages && combined.estimate.stages.length > 0) setConfirming(kind);
      else void dispatchSync(kind);
    },
    [combined, dispatchSync],
  );

  // A settled estimate/sync job flips a connector's `pending` server-side; reload so
  // the Process button (and its summary) appears/disappears without a page refresh.
  useEffect(
    () =>
      onJobSettled((job) => {
        if (job.type === ESTIMATE_TYPE || job.type === SYNC_TYPE) load();
      }),
    [onJobSettled, load],
  );

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
          connectors.map((c) => {
            const pending = c.connection?.pending ?? null;
            const estimating = !!activeJobFor(ESTIMATE_TYPE, estimateKey(c.kind));
            const processing = anyProcessing;
            // Both buttons disabled while either job runs — never let Sync and
            // Process run concurrently — or while this row's POST is in flight.
            const busy = estimating || processing || submitting === c.kind;
            return (
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
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-2">
                    {isConnected(c) && (
                      <button
                        type="button"
                        onClick={() => void dispatchEstimate(c.kind)}
                        disabled={busy}
                        className="rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-50"
                      >
                        {estimating ? 'Syncing…' : 'Sync now'}
                      </button>
                    )}
                    {pending && (
                      <button
                        type="button"
                        onClick={() => onProcess(c.kind)}
                        disabled={busy}
                        className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {processing ? 'Processing…' : 'Process'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfiguring(c.kind)}
                      className="rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40"
                    >
                      Configure
                    </button>
                  </div>
                  {pending && (
                    <div className="text-xs text-muted-foreground">{pendingSummary(pending)}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {active && (
        <ConnectorDrawer
          connector={active}
          onClose={() => setConfiguring(null)}
          onChanged={load}
        />
      )}

      {/* Process confirm: opens instantly from the stored estimates, summing every
          source into one workspace run (per-source lines when >1). Confirm dispatches
          the consolidate job; Cancel just closes. */}
      {confirming && (
        <LlmEstimateModal
          estimate={combined.estimate}
          sources={combined.sources}
          onConfirm={() => {
            const kind = confirming;
            setConfirming(null);
            void dispatchSync(kind);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
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
        {/* "Sync now" / "Process" live in the connector row on the page; the drawer
            is for configuration only. */}
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
