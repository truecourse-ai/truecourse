/**
 * Activity, level one: every agentic run of the repository as one flat table.
 *
 * A row is the whole run at a glance — what it was, whether it is alive, how
 * far its step checklist got (a dot per step plus the active step's own
 * counter), how many sessions it holds and how many of them are waiting on an
 * answer, the ref it ran against, when it started and how long it took.
 * Opening a row is level two: the run as a conversation.
 */

import { useMemo, useState } from 'react';
import { FilterBar } from '@/components/ui/filter-bar';
import type { PublicSessionRun } from '@/lib/api';
import {
  STEP_DOT,
  RUN_STATUS_META,
  commandLabel,
  progressSentence,
  runChecklist,
  runDuration,
  shortRef,
  startedLabel,
  waitingCount,
  type RunStatus,
} from './run-model';

/** One grid template for the head and every row, so the columns line up. */
const COLUMNS =
  'grid grid-cols-[minmax(0,1.2fr)_120px_320px_150px_100px_120px_80px] items-center gap-3 px-6';

const HEADINGS = ['Run', 'Status', 'Progress', 'Sessions', 'Ref', 'Started'] as const;

export function RunsIndex({
  runs,
  error,
  notFound,
  onOpen,
}: {
  /** null while the first read is in flight — a spinner, not "no runs". */
  runs: PublicSessionRun[] | null;
  error: string | null;
  /** A `?run=` deep link that matched nothing in the store. */
  notFound: boolean;
  onOpen: (runId: string) => void;
}) {
  const [kinds, setKinds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const all = useMemo(() => runs ?? [], [runs]);

  // Zero-count chips never render: the vocabulary on screen is the vocabulary
  // this repository's runs actually use.
  const kindOptions = useMemo(
    () =>
      [...new Set(all.map((r) => r.command))].map((command) => ({
        key: command,
        label: commandLabel(command),
        count: all.filter((r) => r.command === command).length,
      })),
    [all],
  );
  const statusOptions = useMemo(
    () =>
      (Object.keys(RUN_STATUS_META) as RunStatus[])
        .map((key) => ({
          key,
          label: RUN_STATUS_META[key].word,
          count: all.filter((r) => r.status === key).length,
        }))
        .filter((o) => o.count > 0),
    [all],
  );

  const shown = all.filter(
    (r) =>
      (kinds.length === 0 || kinds.includes(r.command)) &&
      (statuses.length === 0 || statuses.includes(r.status)),
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-6">
        <span className="text-[13px] font-semibold text-foreground">Activity</span>
        <span className="text-[11px] text-muted-foreground">
          {all.length} {all.length === 1 ? 'run' : 'runs'}
        </span>
        {notFound && (
          <span className="text-[11px] text-amber-500">The linked run is not in this store.</span>
        )}
      </div>

      {/* Both chip groups on ONE line, the way the table's head reads. An
          empty store has neither, so the row itself goes. */}
      <div className={`flex shrink-0 items-center ${kindOptions.length === 0 ? 'hidden' : ''}`}>
        <FilterBar
          label="Kind"
          ariaLabel="Filter runs by kind"
          options={kindOptions}
          selected={kinds}
          onChange={setKinds}
          multi
        />
        <FilterBar
          label="Status"
          ariaLabel="Filter runs by status"
          options={statusOptions}
          selected={statuses}
          onChange={setStatuses}
          multi
        />
        <div className="h-full flex-1 border-b border-border" />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[1040px]">
          <div
            className={`${COLUMNS} sticky top-0 z-10 border-b border-border bg-background py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground`}
          >
            {HEADINGS.map((h) => (
              <span key={h}>{h}</span>
            ))}
            <span className="text-right">Took</span>
          </div>

          {error ? (
            <p className="px-6 py-8 text-center text-xs text-red-500">{error}</p>
          ) : runs === null ? (
            <p className="px-6 py-8 text-center text-xs text-muted-foreground">Reading runs…</p>
          ) : all.length === 0 ? (
            <p className="px-6 py-8 text-center text-xs text-muted-foreground">
              No agentic runs yet. Start one with `truecourse spec scan` (or any guard command).
            </p>
          ) : shown.length === 0 ? (
            <p className="px-6 py-8 text-center text-xs text-muted-foreground">
              No run matches these filters.
            </p>
          ) : (
            shown.map((run) => <RunRow key={run.runId} run={run} onOpen={onOpen} />)
          )}
        </div>
      </div>
    </div>
  );
}

function RunRow({ run, onOpen }: { run: PublicSessionRun; onOpen: (runId: string) => void }) {
  const meta = RUN_STATUS_META[run.status];
  const waiting = waitingCount(run);
  const steps = runChecklist(run);
  const took = runDuration(run);
  return (
    <button
      type="button"
      onClick={() => onOpen(run.runId)}
      // Named explicitly: a row's cells alone read as a word salad, and the
      // start time is what tells two runs of one command apart.
      aria-label={`Open ${commandLabel(run.command)} run from ${startedLabel(run.startedAt)}`}
      className={`${COLUMNS} w-full border-b border-border/60 py-[11px] text-left hover:bg-muted/40`}
    >
      <span className="min-w-0 truncate text-xs font-medium text-foreground">
        {commandLabel(run.command)}
      </span>

      <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        {meta.word}
      </span>

      <span className="inline-flex min-w-0 items-center gap-2">
        <span className="inline-flex shrink-0 gap-1">
          {steps.map((step) => (
            <span
              key={step.key}
              aria-hidden
              className={`box-border h-[7px] w-[7px] rounded-full ${STEP_DOT[step.status]}`}
            />
          ))}
        </span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {progressSentence(steps, run.status)}
        </span>
      </span>

      <span className="text-[11px] text-foreground">
        {run.sessions.length}
        {waiting > 0 && <span className="text-sky-400"> · {waiting} needs you</span>}
      </span>

      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
        {shortRef(run.gitRef)}
      </span>
      <span className="text-[11px] text-muted-foreground">{startedLabel(run.startedAt)}</span>
      <span className="text-right text-[11px] tabular-nums text-muted-foreground">{took}</span>
    </button>
  );
}
