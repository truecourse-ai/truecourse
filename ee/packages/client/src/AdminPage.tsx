/**
 * The Admin console (enterprise, operator-only): a cross-org view of the
 * AI-observability LLM traces and background jobs. The nav entry is hidden for
 * non-operators (per-user gate in the shell); this page additionally relies on
 * the server — every `/api/ee/admin/*` call 403s a non-operator, surfaced here
 * as an "operator access required" state.
 *
 * Operators see every workspace; the org filter narrows to one. The Traces tab's
 * detail panel can open the "same prompt → different outputs" divergence view —
 * the tool for seeing the non-determinism behind duplicate-artifact failures.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, ShieldAlert, X } from 'lucide-react';
import type { JobView, TraceDetail, TraceStats, TraceSummary } from '@truecourse/shared';
import { getJson } from './api';

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleString();
}

function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
}

function TraceStatusBadge({ status }: { status: string }) {
  const ok = status === 'ok';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
        ok ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'
      }`}
    >
      {status}
    </span>
  );
}

const JOB_BADGE: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/15 text-blue-500',
  succeeded: 'bg-emerald-500/15 text-emerald-500',
  failed: 'bg-red-500/15 text-red-500',
};

function OperatorRequired({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded border border-border px-4 py-12 text-sm text-muted-foreground">
      <ShieldAlert className="h-5 w-5" />
      <span>{message}</span>
    </div>
  );
}

function isForbidden(err: unknown): boolean {
  return /operator access required/i.test((err as Error)?.message ?? '');
}

// --- Trace detail + divergence panel ---------------------------------------

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (value == null || value === '') return null;
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre
        className={`max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs leading-relaxed text-foreground ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </pre>
    </div>
  );
}

function TraceDetailPanel({ id, onClose, onPick }: { id: string; onClose: () => void; onPick: (id: string) => void }) {
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siblings, setSiblings] = useState<TraceSummary[] | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    setDetail(null);
    setSiblings(null);
    setError(null);
    getJson<{ trace: TraceDetail }>(`/api/ee/admin/traces/${id}`)
      .then((r) => setDetail(r.trace))
      .catch((e) => setError((e as Error).message));
  }, [id]);

  const compare = useCallback(async () => {
    if (!detail) return;
    setComparing(true);
    setError(null);
    try {
      const r = await getJson<{ traces: TraceSummary[] }>(
        `/api/ee/admin/traces/by-prompt/${detail.promptHash}`,
      );
      setSiblings(r.traces);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setComparing(false);
    }
  }, [detail]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto border-l border-border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold">Trace</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {!detail && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

        {detail && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <Meta k="Workspace" v={detail.workspaceOrgId} />
              <Meta k="Stage" v={detail.stage} />
              <Meta k="Model" v={detail.model} />
              <Meta k="Status" v={detail.status} />
              <Meta k="Slice" v={detail.sliceId} />
              <Meta k="Call" v={detail.callId} />
              <Meta k="Tokens" v={`${detail.promptTokens ?? '–'} → ${detail.completionTokens ?? '–'} (${detail.totalTokens ?? '–'})`} />
              <Meta k="Latency" v={`${detail.latencyMs} ms`} />
              <Meta k="Fallback" v={detail.usedFallback ? 'yes' : 'no'} />
              <Meta k="Finish" v={detail.finishReason} />
            </div>

            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-muted-foreground">prompt #{detail.promptHash.replace(/^sha256-/, '').slice(0, 12)}</span>
              <button
                type="button"
                onClick={() => void compare()}
                disabled={comparing}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted/50 disabled:opacity-60"
              >
                {comparing ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" /> Comparing…
                  </>
                ) : (
                  'Compare same prompt'
                )}
              </button>
            </div>

            {siblings && (
              <div className="space-y-1.5">
                {siblings.length <= 1 ? (
                  <div className="rounded border border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                    This exact prompt has only run once — no other calls to compare against yet.
                  </div>
                ) : (
                  <>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {siblings.length} calls with this exact prompt — click one to inspect its output
                    </div>
                    <div className="divide-y divide-border rounded border border-border">
                      {siblings.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onPick(s.id)}
                          className={`flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left text-xs hover:bg-muted/40 ${
                            s.id === detail.id ? 'bg-primary/[0.08]' : ''
                          }`}
                        >
                          <span className="truncate text-muted-foreground">
                            {s.workspaceOrgId} · {timeAgo(s.createdAt)}
                            {s.id === detail.id ? ' · current' : ''}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">{s.totalTokens ?? '–'} tok</span>
                            <TraceStatusBadge status={s.status} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {detail.errorMessage && <Field label="Error" value={detail.errorMessage} />}
            <Field label="System prompt" value={detail.system} mono />
            <Field label="User prompt" value={detail.user} mono />
            <Field label="Output" value={detail.output} mono />
            <Field label="Reasoning" value={detail.reasoning} mono />
          </>
        )}
      </div>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="truncate font-medium text-foreground">{v ?? '–'}</span>
    </div>
  );
}

// --- Traces tab ------------------------------------------------------------

function TracesTab() {
  const [orgs, setOrgs] = useState<string[]>([]);
  const [org, setOrg] = useState('');
  const [stageDraft, setStageDraft] = useState('');
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<TraceSummary[]>([]);
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ orgs: string[] }>('/api/ee/admin/traces/orgs').then((r) => setOrgs(r.orgs)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const path = `/api/ee/admin/traces${qs({ org, stage, status })}`;
      const [tr, st] = await Promise.all([
        getJson<{ traces: TraceSummary[] }>(path),
        getJson<TraceStats>(`/api/ee/admin/traces/stats${qs({ org })}`),
      ]);
      setRows(tr.traces);
      setStats(st);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [org, stage, status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && isForbidden(error)) return <OperatorRequired message="Operator access required." />;

  return (
    <div className="space-y-4">
      {stats && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Stat label="Calls" value={stats.totalCalls} />
          <Stat label="Errors" value={stats.totalErrors} tone={stats.totalErrors > 0 ? 'bad' : undefined} />
          {stats.stages.slice(0, 6).map((s) => (
            <Stat key={s.stage ?? '∅'} label={s.stage ?? '∅'} value={s.calls} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={org} onChange={(e) => setOrg(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-xs">
          <option value="">All workspaces</option>
          {orgs.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <input
          value={stageDraft}
          onChange={(e) => setStageDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setStage(stageDraft.trim())}
          onBlur={() => setStage(stageDraft.trim())}
          placeholder="stage… (↵)"
          className="w-44 rounded border border-border bg-background px-2 py-1 text-xs"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-xs">
          <option value="">Any status</option>
          <option value="ok">ok</option>
          <option value="error">error</option>
        </select>
        <button type="button" onClick={() => void load()} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted/50">
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <Th>When</Th><Th>Workspace</Th><Th>Stage</Th><Th>Slice</Th><Th>Model</Th><Th>Tokens</Th><Th>Latency</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((t) => (
              <tr key={t.id} onClick={() => setSelected(t.id)} className="cursor-pointer hover:bg-muted/30">
                <Td>{timeAgo(t.createdAt)}</Td>
                <Td>{t.workspaceOrgId ?? '–'}</Td>
                <Td>{t.stage ?? '–'}</Td>
                <Td className="font-mono">{t.sliceId ?? '–'}</Td>
                <Td>{t.model}</Td>
                <Td>{t.totalTokens ?? '–'}</Td>
                <Td>{t.latencyMs} ms</Td>
                <Td><TraceStatusBadge status={t.status} /></Td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No traces.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <TraceDetailPanel id={selected} onClose={() => setSelected(null)} onPick={(id) => setSelected(id)} />
      )}
    </div>
  );
}

// --- Jobs tab --------------------------------------------------------------

function JobDetailPanel({ job, onClose }: { job: JobView; onClose: () => void }) {
  const ts = (v: string | null) => (v ? new Date(v).toLocaleString() : '–');
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto border-l border-border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold">Job</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          <Meta k="Workspace" v={job.workspaceOrgId} />
          <Meta k="Type" v={job.type} />
          <Meta k="Status" v={job.status} />
          <Meta k="Key" v={job.key} />
          <Meta k="Created" v={ts(job.createdAt)} />
          <Meta k="Started" v={ts(job.startedAt)} />
          <Meta k="Finished" v={ts(job.finishedAt)} />
          <Meta k="Progress" v={job.progress.total ? `${job.progress.current}/${job.progress.total}` : '–'} />
        </div>
        <Field label="Progress message" value={job.progress.message} />
        <Field label="Error" value={job.error} mono />
        <Field label="Result" value={job.result != null ? JSON.stringify(job.result, null, 2) : null} mono />
      </div>
    </div>
  );
}

function JobsTab() {
  const [org, setOrg] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<JobView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<JobView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getJson<{ jobs: JobView[] }>(`/api/ee/admin/jobs${qs({ org, status })}`);
      setRows(r.jobs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [org, status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && isForbidden(error)) return <OperatorRequired message="Operator access required." />;

  const orgs = Array.from(new Set(rows.map((r) => r.workspaceOrgId))).sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={org} onChange={(e) => setOrg(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-xs">
          <option value="">All workspaces</option>
          {orgs.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-xs">
          <option value="">Any status</option>
          <option value="queued">queued</option>
          <option value="running">running</option>
          <option value="succeeded">succeeded</option>
          <option value="failed">failed</option>
        </select>
        <button type="button" onClick={() => void load()} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted/50">
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><Th>When</Th><Th>Workspace</Th><Th>Type</Th><Th>Status</Th><Th>Progress</Th><Th>Error</Th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((j) => (
              <tr key={j.id} onClick={() => setSelected(j)} className="cursor-pointer hover:bg-muted/30">
                <Td>{timeAgo(j.createdAt)}</Td>
                <Td>{j.workspaceOrgId}</Td>
                <Td>{j.type}</Td>
                <Td><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${JOB_BADGE[j.status] ?? ''}`}>{j.status}</span></Td>
                <Td>{j.progress.message ?? (j.progress.total ? `${j.progress.current}/${j.progress.total}` : '–')}</Td>
                <Td className="max-w-[20rem] truncate text-red-400">{j.error ?? ''}</Td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No jobs.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && <JobDetailPanel job={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 font-medium">{children}</th>;
}
function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-3 py-2 align-top ${className ?? ''}`}>{children}</td>;
}
function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${tone === 'bad' ? 'text-red-500' : 'text-foreground'}`}>{value}</span>
    </span>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<'traces' | 'jobs'>('traces');
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Cross-workspace operator console — AI traces and background jobs across every tenant.
        </p>
      </header>

      <div className="flex gap-1 border-b border-border">
        {(['traces', 'jobs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'traces' ? 'AI Traces' : 'Jobs'}
          </button>
        ))}
      </div>

      {tab === 'traces' ? <TracesTab /> : <JobsTab />}
    </div>
  );
}
