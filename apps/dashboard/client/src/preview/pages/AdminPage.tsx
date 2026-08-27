/**
 * Admin, for operators: every workspace on this deployment. A left menu like
 * every other page (Jobs, Traces), each a table with search and chip filters.
 */

import { useMemo, useState } from 'react';
import { CHIP_CLASS, PageHeader, SideMenu } from '@/preview/ui/bits';
import { FilterBar } from '@/preview/ui/filter-bar';
import { StatusWord, JOB_TONE, JOB_WORD } from '@/preview/ui/status-word';
import { ADMIN_JOBS, ADMIN_TRACES } from '@/preview/data';
import type { AdminJob } from '@/preview/data/types';

const BASE = '/preview/admin';

function JobsTable() {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [workspaceFilter, setWorkspaceFilter] = useState<string[]>([]);

  const statusOptions = useMemo(
    () =>
      (['queued', 'running', 'succeeded', 'failed'] as AdminJob['status'][])
        .map((key) => ({ key, label: JOB_WORD[key], count: ADMIN_JOBS.filter((j) => j.status === key).length }))
        .filter((o) => o.count > 0),
    [],
  );
  const workspaceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const j of ADMIN_JOBS) counts.set(j.workspace, (counts.get(j.workspace) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: key, count }));
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ADMIN_JOBS.filter(
      (j) =>
        (!q || j.key.toLowerCase().includes(q) || j.type.toLowerCase().includes(q)) &&
        (statusFilter.length === 0 || statusFilter.includes(j.status)) &&
        (workspaceFilter.length === 0 || workspaceFilter.includes(j.workspace)),
    );
  }, [query, statusFilter, workspaceFilter]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search jobs"
          placeholder="Search jobs"
          className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center gap-x-4 [&>div]:border-0 [&>div]:px-0 [&>div]:py-0">
          <FilterBar label="Status" ariaLabel="Filter jobs by status" options={statusOptions} selected={statusFilter} onChange={setStatusFilter} multi />
          <FilterBar
            label="Workspace"
            ariaLabel="Filter jobs by workspace"
            options={workspaceOptions}
            selected={workspaceFilter}
            onChange={setWorkspaceFilter}
            multi
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]" aria-label="Jobs across workspaces">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Job</th>
              <th className="px-3 py-2 text-left font-semibold">Type</th>
              <th className="px-3 py-2 text-left font-semibold">Workspace</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-6 py-2 text-right font-semibold">Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} className="border-b border-border/60">
                <td className="px-6 py-2.5 font-mono text-[12px] text-foreground">{j.key}</td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-muted-foreground">{j.type}</td>
                <td className="px-3 py-2.5 text-foreground">{j.workspace}</td>
                <td className="px-3 py-2.5">
                  <StatusWord tone={JOB_TONE[j.status]} word={JOB_WORD[j.status]} />
                </td>
                <td className="px-6 py-2.5 text-right tabular-nums text-muted-foreground">{j.duration}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                  No job matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TracesTable() {
  const [query, setQuery] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState<string[]>([]);
  const [modelFilter, setModelFilter] = useState<string[]>([]);

  const workspaceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of ADMIN_TRACES) counts.set(t.workspace, (counts.get(t.workspace) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: key, count }));
  }, []);
  const modelOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of ADMIN_TRACES) counts.set(t.model, (counts.get(t.model) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: key, count }));
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ADMIN_TRACES.filter(
      (t) =>
        (!q || t.model.toLowerCase().includes(q) || t.stage.toLowerCase().includes(q)) &&
        (workspaceFilter.length === 0 || workspaceFilter.includes(t.workspace)) &&
        (modelFilter.length === 0 || modelFilter.includes(t.model)),
    );
  }, [query, workspaceFilter, modelFilter]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search traces"
          placeholder="Search traces"
          className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center gap-x-4 [&>div]:border-0 [&>div]:px-0 [&>div]:py-0">
          <FilterBar
            label="Workspace"
            ariaLabel="Filter traces by workspace"
            options={workspaceOptions}
            selected={workspaceFilter}
            onChange={setWorkspaceFilter}
            multi
          />
          <FilterBar label="Model" ariaLabel="Filter traces by model" options={modelOptions} selected={modelFilter} onChange={setModelFilter} multi />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]" aria-label="LLM traces">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Stage</th>
              <th className="px-3 py-2 text-left font-semibold">Model</th>
              <th className="px-3 py-2 text-left font-semibold">Workspace</th>
              <th className="px-3 py-2 text-right font-semibold">Tokens in</th>
              <th className="px-3 py-2 text-right font-semibold">Tokens out</th>
              <th className="px-3 py-2 text-right font-semibold">Cost</th>
              <th className="px-6 py-2 text-left font-semibold">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-border/60">
                <td className="px-6 py-2.5 font-mono text-[12px] text-foreground">{t.stage}</td>
                <td className="px-3 py-2.5">
                  <span className={CHIP_CLASS}>{t.model}</span>
                </td>
                <td className="px-3 py-2.5 text-foreground">{t.workspace}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{t.tokensIn.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{t.tokensOut.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{t.cost}</td>
                <td className="px-6 py-2.5 text-muted-foreground">{t.at}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                  No trace matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminPage({ tab = 'jobs' }: { tab?: 'jobs' | 'traces' }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Admin" />
      <div className="flex min-h-0 flex-1">
        <SideMenu
          label="Admin sections"
          activeId={tab}
          items={[
            { id: 'jobs', label: 'Jobs', to: BASE },
            { id: 'traces', label: 'Traces', to: `${BASE}/traces` },
          ]}
        />
        <div className="min-h-0 min-w-0 flex-1">{tab === 'jobs' ? <JobsTable /> : <TracesTable />}</div>
      </div>
    </div>
  );
}
