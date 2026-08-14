/**
 * UI MOCK — the Activity surface of AGENTIC_PIPELINE_PLAN §3.6–§3.9, on mock
 * data only (see ./mock.ts): every agentic run (scan, setup, generate) in one
 * list, and per run its sessions and their live transcripts, chat included.
 * Layout: runs (left) → the selected run's header + session rail (middle) →
 * the selected session's transcript/chat (right). Swap the mock for the
 * sessions-store reads when §3.9 lands; the composition is the keeper.
 */

import { useMemo, useState } from 'react';
import { CircleDot, HelpCircle, Radio } from 'lucide-react';
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list';
import { MOCK_RUNS, type MockRun, type MockSession, type SessionStatus } from './mock';
import { SessionTranscript } from './SessionTranscript';

const RUN_STATUS_META = {
  running: { word: 'running', cls: 'text-sky-500' },
  finished: { word: 'finished', cls: 'text-emerald-500' },
  failed: { word: 'failed', cls: 'text-red-500' },
} as const;

const SESSION_STATUS_META: Record<SessionStatus, { word: string; cls: string }> = {
  active: { word: 'active', cls: 'border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  'awaiting-input': { word: 'needs you', cls: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  queued: { word: 'queued', cls: 'border-border text-muted-foreground' },
  done: { word: 'done', cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  failed: { word: 'failed', cls: 'border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400' },
  blocked: { word: 'blocked', cls: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400' },
};

const COUNTER_TONE = {
  ok: 'text-emerald-500',
  warn: 'text-amber-500',
  fail: 'text-red-500',
  muted: 'text-muted-foreground',
  active: 'text-sky-500',
} as const;

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
          <span className="flex shrink-0 items-center gap-0.5 rounded border border-amber-500/50 bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            <HelpCircle className="h-2.5 w-2.5" />
            {run.questions}
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

/** The §3.6 counter line — the partition that always sums, no bars. */
function CounterLine({ run }: { run: MockRun }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-[11px]">
      {run.counters.map((c, i) => (
        <span key={c.word} className="flex items-baseline gap-1">
          {i > 0 && <span className="text-muted-foreground/50">·</span>}
          <span className={`font-semibold ${COUNTER_TONE[c.tone]}`}>{c.count}</span>
          <span className="text-muted-foreground">{c.word}</span>
        </span>
      ))}
      <span className="text-muted-foreground/50">—</span>
      <span className="text-muted-foreground">
        of {run.total} {run.totalNoun}
      </span>
    </div>
  );
}

function SessionRow({ session }: { session: MockSession }) {
  const meta = SESSION_STATUS_META[session.status];
  return (
    <>
      <div className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{session.workItem}</span>
        <span className={`shrink-0 rounded border px-1 py-0.5 text-[10px] leading-none ${meta.cls}`}>{meta.word}</span>
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
  const sessionGroups = useMemo<EntityListGroup<MockSession>[]>(() => {
    const byKind = new Map<string, MockSession[]>();
    for (const s of sessions) {
      const list = byKind.get(s.kind) ?? [];
      list.push(s);
      byKind.set(s.kind, list);
    }
    return [...byKind.entries()].map(([kind, items]) => ({
      key: kind,
      label: kind,
      count: items.length,
      items,
    }));
  }, [sessions]);

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <aside className="w-60 shrink-0 border-r border-border">
        <EntityList<MockRun>
          label="Agentic runs"
          items={MOCK_RUNS}
          itemId={(r) => r.id}
          renderRow={(r) => <RunRow run={r} />}
          activeId={run?.id ?? null}
          onOpen={(id) => setRunId(id)}
          noun={{ one: 'run', many: 'runs' }}
          emptyText="No agentic runs yet — spec scan, guard setup and guard generate report here."
        />
      </aside>

      {run && (
        <aside className="flex w-80 shrink-0 flex-col border-r border-border">
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
            <CounterLine run={run} />
            {run.questions > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <HelpCircle className="h-3 w-3" />
                {run.questions} question{run.questions === 1 ? '' : 's'} need{run.questions === 1 ? 's' : ''} you
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <EntityList<MockSession>
              label="Run sessions"
              groups={sessionGroups}
              itemId={(s) => s.id}
              renderRow={(s) => <SessionRow session={s} />}
              activeId={session?.id ?? null}
              onOpen={(id) => setSessionByRun((prev) => ({ ...prev, [run.id]: id }))}
              emptyText="No sessions in this run."
            />
          </div>
        </aside>
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
