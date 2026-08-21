/**
 * The Activity surface (AGENTIC_PIPELINE_PLAN §3.6–§3.9) on the real sessions
 * store: every agentic run (scan, setup, generate, interfaces, adjudicate) in
 * one list, and per run its sessions and their transcripts — tailed live over
 * the socket while the run's process is alive. Layout: runs (left) → the
 * selected run's header + session rail (middle) → the selected session's
 * transcript (right).
 *
 * Selection lives in the URL (`?run=<runId>&ses=<sessionId>`), which is what
 * the CLI's "Watch live" deep link points at; the runId is unique across
 * commands, so the command never rides the URL.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleDot, Radio } from 'lucide-react';
import type { SessionIndexEntry, SessionStatus } from '@truecourse/agent-loop';
import { CollapsibleAside } from '@/components/ui/collapsible-aside';
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list';
import { useSessionRuns } from '@/hooks/useSessionRuns';
import { useRunStream } from '@/hooks/useRunStream';
import type { PublicSessionRun } from '@/lib/api';
import { SessionTranscript } from './SessionTranscript';
import { useState } from 'react';

const STATUS = 'inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground';
const DOT = 'h-2 w-2 shrink-0 rounded-full';

const RUN_STATUS_META: Record<PublicSessionRun['status'], { word: string; cls: string }> = {
  running: { word: 'Running', cls: 'text-sky-500' },
  completed: { word: 'Finished', cls: 'text-emerald-500' },
  failed: { word: 'Failed', cls: 'text-red-500' },
  interrupted: { word: 'Interrupted', cls: 'text-amber-500' },
};

const SESSION_STATUS_META: Record<SessionStatus, { word: string; dot: string }> = {
  running: { word: 'Active', dot: 'bg-sky-500' },
  waiting: { word: 'Needs you', dot: 'bg-sky-500' },
  parked: { word: 'Parked', dot: 'bg-amber-500' },
  completed: { word: 'Done', dot: 'bg-emerald-500' },
  failed: { word: 'Failed', dot: 'bg-red-500' },
};

/** `spec-scan` → `spec scan` — the store id as a display phrase. */
const commandLabel = (command: string): string => command.replace(/-/g, ' ');

const startedLabel = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const shortRef = (gitRef: string): string => (/^[0-9a-f]{40}$/.test(gitRef) ? gitRef.slice(0, 8) : gitRef);

/** Sessions awaiting input — the "needs you" badge. */
const waitingCount = (run: PublicSessionRun): number =>
  run.sessions.filter((s) => s.status === 'waiting').length;

const STEP_DOT: Record<string, string> = {
  pending: 'border border-border bg-transparent',
  active: 'bg-sky-500',
  done: 'bg-emerald-500',
  error: 'bg-red-500',
};

/**
 * The run-level phase checklist, shown where the transcript would be while
 * the run has no session to read — spec scan discovers and tags docs long
 * before its first session exists, and this is that work's only surface.
 */
function RunProgress({ run }: { run: PublicSessionRun }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-72">
        <div className="mb-3 text-xs font-semibold text-foreground">
          {commandLabel(run.command)}
          {run.status === 'running' && <span className="ml-2 font-normal text-sky-500">running</span>}
        </div>
        <div className="space-y-2">
          {(run.progress ?? []).map((step) => (
            <div key={step.key} className="flex items-baseline gap-2.5">
              <span aria-hidden className={`h-2 w-2 shrink-0 self-center rounded-full ${STEP_DOT[step.status] ?? STEP_DOT.pending}`} />
              <span className={`text-xs ${step.status === 'pending' ? 'text-muted-foreground/70' : 'text-foreground'}`}>
                {step.label}
              </span>
              {step.detail && (
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">{step.detail}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RunRow({ run }: { run: PublicSessionRun }) {
  const meta = RUN_STATUS_META[run.status];
  const waiting = waitingCount(run);
  return (
    <>
      <div className="flex w-full items-center gap-1.5">
        {run.status === 'running' ? (
          <Radio className={`h-3 w-3 shrink-0 animate-pulse ${meta.cls}`} />
        ) : (
          <CircleDot className={`h-3 w-3 shrink-0 ${meta.cls}`} />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {commandLabel(run.command)}
        </span>
        {waiting > 0 && (
          <span className="shrink-0 text-[10px] font-medium text-sky-600 dark:text-sky-400">
            {waiting} question{waiting === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="flex w-full items-center gap-2 text-[10px] text-muted-foreground">
        <span className="min-w-0 truncate font-mono">{shortRef(run.gitRef)}</span>
        <span className="ml-auto shrink-0">{startedLabel(run.startedAt)}</span>
      </div>
    </>
  );
}

function SessionRow({ session }: { session: SessionIndexEntry }) {
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
      {session.spent.turns > 0 && (
        <div className="text-[10px] text-muted-foreground">{session.spent.turns} turns</div>
      )}
    </>
  );
}

export function SessionsActivityView({ repoId }: { repoId: string }) {
  const { runs, error, refetch } = useSessionRuns(repoId, true);
  const [params, setParams] = useSearchParams();

  const runParam = params.get('run');
  const selectRun = useCallback(
    (runId: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('run', runId);
        next.delete('ses');
        return next;
      }, { replace: true });
    },
    [setParams],
  );
  const selectSession = useCallback(
    (sessionId: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('ses', sessionId);
        return next;
      }, { replace: true });
    },
    [setParams],
  );

  const listedRun = runs?.find((r) => r.runId === runParam) ?? runs?.[0] ?? null;
  const runNotFound = runParam !== null && runs !== null && !runs.some((r) => r.runId === runParam);

  // The live tail of the selected run, while its process is alive. Joined
  // BEFORE the transcript snapshots resolve; overlap dedups by seq.
  const { liveEvents, liveRun } = useRunStream(
    repoId,
    listedRun?.command ?? null,
    listedRun?.runId ?? null,
    listedRun?.status === 'running',
  );
  // The pushed record is always fresher than the listing's.
  const run = liveRun && liveRun.runId === listedRun?.runId ? liveRun : listedRun;

  // A run that just left `running` (finished, failed, interrupted) re-reads the
  // list so the rail agrees with the store.
  useEffect(() => {
    if (liveRun && liveRun.status !== 'running') void refetch();
  }, [liveRun, liveRun?.status, refetch]);

  const sessions = run?.sessions ?? [];
  const sesParam = params.get('ses');
  const session = sessions.find((s) => s.sessionId === sesParam) ?? sessions[0] ?? null;

  // One group per session kind — registry order is the authoring order.
  const groupSessions = useCallback((items: SessionIndexEntry[]): EntityListGroup<SessionIndexEntry>[] => {
    const byKind = new Map<string, SessionIndexEntry[]>();
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
        <EntityList<PublicSessionRun>
          label="Agentic runs"
          items={runs ?? []}
          itemId={(r) => r.runId}
          renderRow={(r) => <RunRow run={r} />}
          activeId={run?.runId ?? null}
          onOpen={selectRun}
          noun={{ one: 'run', many: 'runs' }}
          loading={runs === null && error === null}
          error={error}
          emptyText="No agentic runs yet. Start one with `truecourse spec scan` (or any guard command)."
        />
      </CollapsibleAside>

      {run && (
        <CollapsibleAside label="Sessions" defaultWidth={320}>
          {/* The aside wraps children in a BLOCK, so the header/list split needs
              its own flex column or the list clips instead of scrolling. */}
          <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{commandLabel(run.command)}</span>
              <span className={`text-[11px] ${RUN_STATUS_META[run.status].cls}`}>
                {RUN_STATUS_META[run.status].word}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="font-mono">{shortRef(run.gitRef)}</span>
              <span className="ml-auto">{startedLabel(run.startedAt)}</span>
            </div>
            {runNotFound && (
              <div className="text-[11px] text-amber-500">
                The linked run was not found — showing the latest instead.
              </div>
            )}
            {waitingCount(run) > 0 && (
              <div className="text-[11px] text-sky-600 dark:text-sky-400">
                {waitingCount(run)} question{waitingCount(run) === 1 ? '' : 's'} need
                {waitingCount(run) === 1 ? 's' : ''} you
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <EntityList<SessionIndexEntry>
              label="Run sessions"
              items={sessions}
              group={groupSessions}
              itemId={(s) => s.sessionId}
              renderRow={(s) => <SessionRow session={s} />}
              activeId={session?.sessionId ?? null}
              onOpen={selectSession}
              filter={{
                label: 'Status',
                ariaLabel: 'Filter sessions by status',
                options: statusOptions,
                selected: statusFilter,
                onChange: setStatusFilter,
                match: (s, key) => s.status === key,
                multi: true,
              }}
              emptyText="No sessions in this run yet."
            />
          </div>
          </div>
        </CollapsibleAside>
      )}

      {run && session ? (
        <SessionTranscript
          key={`${run.runId}:${session.sessionId}`}
          repoId={repoId}
          command={run.command}
          runId={run.runId}
          session={session}
          liveEvents={liveEvents.get(session.sessionId) ?? []}
        />
      ) : run && (run.progress?.length ?? 0) > 0 ? (
        <RunProgress run={run} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {runs !== null && runs.length === 0
            ? 'No agentic runs yet.'
            : 'Pick a session to read its transcript.'}
        </div>
      )}
    </div>
  );
}
