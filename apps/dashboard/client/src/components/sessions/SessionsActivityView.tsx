/**
 * UI MOCK — the Activity surface of AGENTIC_PIPELINE_PLAN §3.6–§3.9, on mock
 * data only (see ./mock.ts): every agentic run (scan, setup, generate) in one
 * list, and per run its sessions and their live transcripts, chat included.
 * Layout: runs (left) → the selected run's header + session rail (middle) →
 * the selected session's transcript/chat (right). Swap the mock for the
 * sessions-store reads when §3.9 lands; the composition is the keeper.
 */

import { useCallback, useMemo, useState } from 'react';
import { CircleDot, Radio } from 'lucide-react';
import { CollapsibleAside } from '@/components/ui/collapsible-aside';
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list';
import { MOCK_RUNS, type MockRun, type MockSession, type SessionStatus } from './mock';
import { SessionTranscript } from './SessionTranscript';

const STATUS = 'inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground';
const DOT = 'h-2 w-2 shrink-0 rounded-full';

const RUN_STATUS_META = {
  running: { word: 'Running', cls: 'text-sky-500' },
  finished: { word: 'Finished', cls: 'text-emerald-500' },
  failed: { word: 'Failed', cls: 'text-red-500' },
} as const;

const SESSION_STATUS_META: Record<SessionStatus, { word: string; dot: string }> = {
  active: { word: 'Active', dot: 'bg-sky-500' },
  'awaiting-input': { word: 'Needs you', dot: 'bg-sky-500' },
  queued: { word: 'Queued', dot: 'bg-slate-400' },
  done: { word: 'Done', dot: 'bg-emerald-500' },
  failed: { word: 'Failed', dot: 'bg-red-500' },
  blocked: { word: 'Blocked', dot: 'bg-sky-500' },
};

function RunRow({ run }: { run: MockRun }) {
  const meta = RUN_STATUS_META[run.status];
  return (
    <>
      <div className="flex w-full items-center gap-1.5">
        {run.status === 'running' ? (
          <Radio className={`h-3 w-3 shrink-0 animate-pulse ${meta.cls}`} />
        ) : (
          <CircleDot className={`h-3 w-3 shrink-0 ${meta.cls}`} />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{run.command}</span>
        {run.questions > 0 && (
          <span className="shrink-0 text-[10px] font-medium text-sky-600 dark:text-sky-400">
            {run.questions} question{run.questions === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="flex w-full items-center gap-2 text-[10px] text-muted-foreground">
        <span className="min-w-0 truncate font-mono">{run.gitRef}</span>
        <span className="ml-auto shrink-0">{run.started}</span>
      </div>
    </>
  );
}

function SessionRow({ session }: { session: MockSession }) {
  const meta = SESSION_STATUS_META[session.status];
  return (
    <>
      <div className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{session.workItem}</span>
        <span className={STATUS}>
          <span aria-hidden className={`${DOT} ${meta.dot}`} />
          {meta.word}
        </span>
      </div>
      {session.turns > 0 && (
        <div className="text-[10px] text-muted-foreground">
          {session.turns}/{session.budget} turns
        </div>
      )}
    </>
  );
}

export function SessionsActivityView() {
  const [runId, setRunId] = useState<string>(MOCK_RUNS[0]?.id ?? '');
  const run = MOCK_RUNS.find((r) => r.id === runId) ?? MOCK_RUNS[0];
  const [sessionByRun, setSessionByRun] = useState<Record<string, string>>({});

  const sessions = run?.sessions ?? [];
  const sessionId = run ? sessionByRun[run.id] ?? sessions[0]?.id ?? '' : '';
  const session = sessions.find((s) => s.id === sessionId) ?? sessions[0] ?? null;

  // One group per session kind, orchestrator first — registry order is the
  // authoring order (orchestrator → workers), which the mock data already has.
  const groupSessions = useCallback((items: MockSession[]): EntityListGroup<MockSession>[] => {
    const byKind = new Map<string, MockSession[]>();
    for (const s of items) {
      const list = byKind.get(s.kind) ?? [];
      list.push(s);
      byKind.set(s.kind, list);
    }
    return [...byKind.entries()].map(([kind, rows]) => ({
      key: kind,
      label: kind,
      count: rows.length,
      items: rows,
    }));
  }, []);

  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const statusOptions = useMemo(
    () =>
      (Object.keys(SESSION_STATUS_META) as SessionStatus[])
        .map((key) => ({
          key,
          label: SESSION_STATUS_META[key].word,
          count: sessions.filter((s) => s.status === key).length,
        }))
        .filter((o) => o.count > 0),
    [sessions],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <CollapsibleAside label="Runs" defaultWidth={240}>
        <EntityList<MockRun>
          label="Agentic runs"
          items={MOCK_RUNS}
          itemId={(r) => r.id}
          renderRow={(r) => <RunRow run={r} />}
          activeId={run?.id ?? null}
          onOpen={(id) => setRunId(id)}
          noun={{ one: 'run', many: 'runs' }}
          emptyText="No agentic runs yet."
        />
      </CollapsibleAside>

      {run && (
        <CollapsibleAside label="Sessions" defaultWidth={320}>
          <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{run.command}</span>
              <span className={`text-[11px] ${RUN_STATUS_META[run.status].cls}`}>
                {RUN_STATUS_META[run.status].word}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="font-mono">{run.gitRef}</span>
              <span className="ml-auto">{run.started}</span>
            </div>
            {run.questions > 0 && (
              <div className="text-[11px] text-sky-600 dark:text-sky-400">
                {run.questions} question{run.questions === 1 ? '' : 's'} need{run.questions === 1 ? 's' : ''} you
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <EntityList<MockSession>
              label="Run sessions"
              items={sessions}
              group={groupSessions}
              itemId={(s) => s.id}
              renderRow={(s) => <SessionRow session={s} />}
              activeId={session?.id ?? null}
              onOpen={(id) => setSessionByRun((prev) => ({ ...prev, [run.id]: id }))}
              filter={{
                label: 'Status',
                ariaLabel: 'Filter sessions by status',
                options: statusOptions,
                selected: statusFilter,
                onChange: setStatusFilter,
                match: (s, key) => s.status === key,
                multi: true,
              }}
              emptyText="No sessions in this run."
            />
          </div>
        </CollapsibleAside>
      )}

      {run && session ? (
        <SessionTranscript session={session} runLive={run.status === 'running'} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          Pick a session to read its transcript.
        </div>
      )}
    </div>
  );
}
