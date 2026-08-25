// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
/**
 * UI MOCK: the Activity surface of AGENTIC_PIPELINE_PLAN §3.6–§3.9, on mock
 * data only (see ./mock.ts). A flat table of every agent session of this
 * repository, each row named by the command that ran it (spec scan, guard
 * setup, guard generate), with Kind and Status filters; a row opens the session
 * as its own page (`/activity/:sessionId`, the transcript and chat). The run a
 * session belonged to is a fact on the row, never a level to click through.
 *
 * Reached only for a FIXTURE repository: on a real (URL-connected) one the
 * console mounts `@/components/sessions/SessionsActivityView` instead, which
 * reads and live-tails the repository's own sessions store.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, ChevronRight, Radio } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/preview/ui/bits';
import { FilterBar } from '@/preview/ui/filter-bar';
import { MOCK_RUNS, type MockRun, type MockSession, type SessionStatus } from './mock';
import { SessionTranscript } from './SessionTranscript';

const SESSION_STATUS_META: Record<SessionStatus, { word: string; dot: string }> = {
  active: { word: 'Active', dot: 'bg-sky-500' },
  'awaiting-input': { word: 'Needs you', dot: 'bg-sky-500' },
  queued: { word: 'Queued', dot: 'bg-slate-400' },
  done: { word: 'Done', dot: 'bg-emerald-500' },
  failed: { word: 'Failed', dot: 'bg-red-500' },
  blocked: { word: 'Blocked', dot: 'bg-sky-500' },
};

/** One row per session, whatever run it belonged to: the list has ONE level. */
interface SessionItem {
  session: MockSession;
  run: MockRun;
}

const SESSIONS: SessionItem[] = MOCK_RUNS.flatMap((run) => run.sessions.map((session) => ({ session, run })));

const KINDS: MockRun['command'][] = ['spec scan', 'guard setup', 'guard generate'];

function StatusWord({ status }: { status: SessionStatus }) {
  const meta = SESSION_STATUS_META[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      {meta.word}
    </span>
  );
}

export function SessionsActivityView({ repoId }: { repoId: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  const kindOptions = useMemo(
    () =>
      KINDS.map((key) => ({ key, label: key, count: SESSIONS.filter((i) => i.run.command === key).length })).filter(
        (o) => o.count > 0,
      ),
    [],
  );
  const statusOptions = useMemo(
    () =>
      (Object.keys(SESSION_STATUS_META) as SessionStatus[])
        .map((key) => ({
          key,
          label: SESSION_STATUS_META[key].word,
          count: SESSIONS.filter((i) => i.session.status === key).length,
        }))
        .filter((o) => o.count > 0),
    [],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SESSIONS.filter(
      (i) =>
        (!q ||
          i.session.workItem.toLowerCase().includes(q) ||
          i.session.kind.toLowerCase().includes(q) ||
          i.run.command.includes(q)) &&
        (kindFilter.length === 0 || kindFilter.includes(i.run.command)) &&
        (statusFilter.length === 0 || statusFilter.includes(i.session.status)),
    );
  }, [query, kindFilter, statusFilter]);

  const openSession = (id: string) => navigate(`/preview/repos/${repoId}/activity/${encodeURIComponent(id)}`);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Activity"
        subtitle={rows.length === SESSIONS.length ? `${SESSIONS.length}` : `${rows.length} of ${SESSIONS.length}`}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search sessions"
          placeholder="Search sessions"
          className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center gap-x-4 [&>div]:border-0 [&>div]:px-0 [&>div]:py-0">
          <FilterBar label="Kind" ariaLabel="Filter sessions by kind" options={kindOptions} selected={kindFilter} onChange={setKindFilter} multi />
          <FilterBar
            label="Status"
            ariaLabel="Filter sessions by status"
            options={statusOptions}
            selected={statusFilter}
            onChange={setStatusFilter}
            multi
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]" aria-label="Agent sessions">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Session</th>
              <th className="px-3 py-2 text-left font-semibold">Kind</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Turns</th>
              <th className="px-3 py-2 text-left font-semibold">Ref</th>
              <th className="px-6 py-2 text-left font-semibold">Started</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ session, run }) => (
              <tr
                key={session.id}
                tabIndex={0}
                onClick={() => openSession(session.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openSession(session.id);
                }}
                className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
              >
                <td className="px-6 py-2.5">
                  <span className="flex items-center gap-2">
                    {run.status === 'running' && session.status === 'active' && (
                      <Radio className="h-3 w-3 shrink-0 animate-pulse text-sky-500" />
                    )}
                    <span className="block truncate font-mono text-[12px] text-foreground">{session.workItem}</span>
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">{session.kind}</span>
                </td>
                <td className="px-3 py-2.5 text-foreground">{run.command}</td>
                <td className="px-3 py-2.5">
                  <StatusWord status={session.status} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                  {session.turns > 0 ? `${session.turns}/${session.budget}` : ''}
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-muted-foreground">{run.gitRef}</td>
                <td className="px-6 py-2.5 text-muted-foreground">{run.started}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                  No session matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SessionPage({ repoId, sessionId }: { repoId: string; sessionId: string }) {
  const item = SESSIONS.find((i) => i.session.id === sessionId) ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link to={`/preview/repos/${repoId}/activity`} className="shrink-0 font-semibold text-foreground hover:underline">
            Activity
          </Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <h1 className="min-w-0 truncate font-semibold text-foreground">
            {item ? `${item.run.command} · ${item.session.workItem}` : sessionId}
          </h1>
        </nav>
        {item && (
          <span className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
            <span>{item.session.kind}</span>
            <span className="font-mono">{item.run.gitRef}</span>
            <span>{item.run.started}</span>
            <StatusWord status={item.session.status} />
          </span>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        {item ? (
          <SessionTranscript session={item.session} runLive={item.run.status === 'running'} />
        ) : (
          <EmptyState icon={Activity} title="No such session" body="Nothing is recorded under that id." />
        )}
      </div>
    </div>
  );
}
