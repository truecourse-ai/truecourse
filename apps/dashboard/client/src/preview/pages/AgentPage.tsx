/**
 * Agent: everything the agent did, is doing and needs you for, across every
 * connected repository.
 *
 * The index is the platform's index shape (search full width, ONE filter row
 * of Add filter, dimension, value, then a one-line table), and one row is one
 * whole piece of work, which opens as one conversation at `/preview/agent/:runId`.
 * Kind, Status and Repository live in the address (`?kind=&status=&repo=`), so a
 * narrowed page is a place: the repository console, Home and the toasts link
 * straight to `?repo=<id>`.
 *
 * The list follows the work without a reload: the workspace job stream and the
 * repositories' own store writes both re-read it (see `useWorkspaceRuns`).
 *
 * A run record exists once a job's body starts, so work still WAITING for its
 * turn in the workspace's queue would show nowhere. The queue is read beside
 * the runs and its jobs are rows of the same list, which is why one row is one
 * piece of work rather than one run record.
 *
 * The conversation route owns the one-row header (the repository, the status,
 * the ref, how long it took, and Run again when the work ended badly) and
 * mounts the conversation itself below it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MousePointer2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { RunConversationPage, RunElapsed } from '@/components/sessions/RunConversationPage';
import {
  RUN_STATUS_META,
  commandLabel,
  runDuration,
  shortRef,
  startedLabel,
  waitingCount,
  type WorkStatus,
} from '@/components/sessions/run-model';
import type { JobView } from '@truecourse/shared';
import { getWorkspaceRun, type WorkspaceRun } from '@/lib/api';
import { connectSocket } from '@/lib/socket';
import { PageHeader } from '@/preview/ui/bits';
import { filterKey, selectedValues, type FilterDimension } from '@/preview/ui/filter-builder';
import { facetDimensions } from '@/preview/ui/filter-facets';
import { IndexTable, type IndexColumn } from '@/preview/ui/index-table';
import { RUN_STATUS_TONE, StatusWord, tallyOf } from '@/preview/ui/status-word';
import { usePreviewState } from '@/preview/shell/preview-state';
import { useRunTrigger } from '@/preview/shell/use-run-trigger';
import { useWorkspaceRuns } from '@/preview/shell/use-workspace-runs';
import { jobCommand, jobRepoFullName, waitingFact } from '@/preview/shell/use-active-jobs';
import { conversationHref } from '@/preview/shell/real-runs';
import { PREVIEW_BASE } from '@/preview/shell/base';
import { subscribeToServerEvents } from '@/preview/shell/event-stream';
import type { Repo } from '@/preview/data/types';

const STATUSES = Object.keys(RUN_STATUS_META) as WorkStatus[];

/** The filter dimensions, in the order the Add filter menu offers them. */
const DIMENSION_KEYS = ['kind', 'status', 'repo'] as const;
type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** The URL parameter each dimension is spelled with. */
const PARAM: Record<DimensionKey, string> = { kind: 'kind', status: 'status', repo: 'repo' };

/**
 * One piece of work on the index: a run of the agent, or a job the workspace
 * has not started yet, which has no run record to be listed by. Never both and
 * never neither — see {@link jobRow} for the handover.
 */
interface AgentRow {
  id: string;
  command: string;
  status: WorkStatus;
  repo: { id: string; fullName: string } | null;
  /** The ref the work is on; work that has not started names none. */
  gitRef: string;
  /** When the work started, or when it was enqueued. */
  startedAt: string;
  /** What work that is still waiting is waiting for. */
  waitingOn: string | null;
  /** The record behind the row, once the work has written one. */
  run: WorkspaceRun | null;
  /** Where the row opens; null when the workspace has nowhere to send it. */
  href: string | null;
}

const runRow = (run: WorkspaceRun): AgentRow => ({
  id: run.runId,
  command: run.command,
  status: run.status,
  repo: run.repo,
  gitRef: run.gitRef,
  startedAt: run.startedAt,
  waitingOn: null,
  run,
  href: conversationHref(run.runId),
});

/**
 * A job as a row, until its own run record takes over. The record is written
 * when the job's BODY starts, so a job that has just turned `running` is still
 * the only row its work has: the row stands until a run of the same repository
 * and command, started no earlier than the job, is in the list — which is what
 * keeps it from vanishing and reappearing.
 *
 * A job that runs no conversation (a source sync) is nobody's row and is null.
 */
function jobRow(
  job: JobView,
  jobs: readonly JobView[],
  runs: readonly WorkspaceRun[],
  repos: readonly Repo[],
): AgentRow | null {
  const command = jobCommand(job);
  if (!command) return null;
  const fullName = jobRepoFullName(job);
  const at = job.startedAt ?? job.createdAt;
  const started = runs.some(
    (run) =>
      run.command === command &&
      (run.repo?.fullName ?? null) === fullName &&
      Date.parse(run.startedAt) >= Date.parse(at),
  );
  if (started) return null;
  const repo = repos.find((r) => r.fullName === fullName) ?? null;
  return {
    id: `job-${job.id}`,
    command,
    status: job.status === 'queued' ? 'queued' : 'running',
    repo: repo ? { id: repo.id, fullName: repo.fullName } : null,
    gitRef: '',
    startedAt: at,
    waitingOn: job.status === 'queued' ? waitingFact(job, jobs) : null,
    run: null,
    // Where the work will appear when it starts: the repository's pipeline, and
    // for the workspace's own document scan the Context it reads.
    href: fullName
      ? repo
        ? `${PREVIEW_BASE}/repos/${repo.id}/pipeline`
        : null
      : `${PREVIEW_BASE}/context`,
  };
}

export default function AgentPage({ runId }: { runId?: string }) {
  return runId ? <ConversationRoute runId={runId} /> : <AgentIndex />;
}

function AgentIndex() {
  const navigate = useNavigate();
  const { repos, activeJobs } = usePreviewState();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');

  const connected = repos;
  const repoIds = useMemo(() => connected.map((r) => r.id), [connected]);
  const { runs: records, error } = useWorkspaceRuns(repoIds);

  // Every run of the workspace, and the work still waiting to become one.
  const runs = useMemo<AgentRow[] | null>(() => {
    if (records === null) return null;
    const waiting = activeJobs
      .map((job) => jobRow(job, activeJobs, records, connected))
      .filter((row): row is AgentRow => row !== null);
    return [...waiting, ...records.map(runRow)].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }, [records, activeJobs, connected]);

  // The selection is the address: `?kind=spec-scan&repo=owner-repo`, several
  // values per dimension, as the builder's `dimension:value` keys.
  const selected = useMemo(
    () =>
      DIMENSION_KEYS.flatMap((d) => params.getAll(PARAM[d]).map((value) => filterKey(d, value))),
    [params],
  );

  const onSelect = useCallback(
    (next: string[]) => {
      const grouped = new URLSearchParams();
      for (const d of DIMENSION_KEYS) {
        for (const value of selectedValues(next, d)) grouped.append(PARAM[d], value);
      }
      setParams(grouped, { replace: true });
    },
    [setParams],
  );

  const matchesQuery = useCallback(
    (row: AgentRow) => {
      const q = query.trim().toLowerCase();
      return (
        q === '' ||
        commandLabel(row.command).toLowerCase().includes(q) ||
        (row.repo?.fullName.toLowerCase().includes(q) ?? false) ||
        row.gitRef.toLowerCase().includes(q)
      );
    },
    [query],
  );

  const rows = useMemo(() => {
    const all = runs ?? [];
    const kinds = selectedValues(selected, 'kind');
    const statuses = selectedValues(selected, 'status');
    const pickedRepos = selectedValues(selected, 'repo');
    return all.filter(
      (row) =>
        (kinds.length === 0 || kinds.includes(row.command)) &&
        (statuses.length === 0 || statuses.includes(row.status)) &&
        (pickedRepos.length === 0 || (row.repo !== null && pickedRepos.includes(row.repo.id))) &&
        matchesQuery(row),
    );
  }, [runs, matchesQuery, selected]);

  const tally = useMemo(
    () =>
      tallyOf(rows, STATUSES, (row) => row.status, (status) => ({
        word: RUN_STATUS_META[status].word,
        tone: RUN_STATUS_TONE[status],
      })),
    [rows],
  );

  const dimensions = useMemo<FilterDimension[]>(() => {
    const all = runs ?? [];
    const commands = [...new Set(all.map((r) => r.command))].sort();
    return facetDimensions<AgentRow>({
      rows: all,
      selected,
      matches: matchesQuery,
      dimensions: [
        {
          key: 'kind',
          label: 'Kind',
          valuesOf: (row) => [row.command],
          values: commands.map((command) => ({ value: command, label: commandLabel(command) })),
        },
        {
          key: 'status',
          label: 'Status',
          valuesOf: (row) => [row.status],
          values: STATUSES.map((status) => ({
            value: status,
            label: RUN_STATUS_META[status].word,
          })),
          hideEmpty: true,
        },
        {
          key: 'repo',
          label: 'Repository',
          valuesOf: (row) => (row.repo === null ? [] : [row.repo.id]),
          values: connected.map((repo) => ({ value: repo.id, label: repo.fullName })),
        },
      ],
    });
  }, [runs, connected, matchesQuery, selected]);

  const columns = useMemo<IndexColumn<AgentRow>[]>(
    () => [
      {
        key: 'conversation',
        label: 'Conversation',
        cell: (row) => (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-foreground">{commandLabel(row.command)}</span>
            {row.waitingOn && (
              <span className="truncate text-[11px] text-muted-foreground">{row.waitingOn}</span>
            )}
          </span>
        ),
      },
      {
        key: 'repository',
        label: 'Repository', width: '14rem',
        className: 'font-mono text-[12px] text-muted-foreground',
        // The workspace's own work (a Document scan reads every source and
        // clones nothing) belongs to no repository, and says so.
        cell: (row) => row.repo?.fullName ?? '—',
      },
      {
        key: 'status',
        label: 'Status', width: '8rem',
        cell: (row) => <RunStatusWord status={row.status} run={row.run} />,
      },
      {
        key: 'started',
        label: 'Started', width: '10rem',
        className: 'text-muted-foreground',
        cell: (row) => startedLabel(row.startedAt),
      },
      {
        key: 'took',
        label: 'Took', width: '6rem',
        align: 'right',
        className: 'text-muted-foreground',
        // Nothing has been taken yet by work that has not begun.
        cell: (row) => (row.run ? runDuration(row.run) : ''),
      },
    ],
    [],
  );

  const narrowed = query.trim() !== '' || selected.length > 0;
  const empty =
    runs === null
      ? 'Loading…'
      : error
        ? `The agent's work could not be read: ${error}`
        : narrowed
          ? 'Nothing matches.'
          : "Nothing yet. A repository's first scan starts the agent.";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Agent" />
      <div className="min-h-0 flex-1">
        <IndexTable
          label="Agent conversations"
          rows={rows}
          total={(runs ?? []).length}
          rowId={(row) => row.id}
          columns={columns}
          onOpen={(row) => {
            if (row.href) navigate(row.href);
          }}
          query={query}
          onQuery={setQuery}
          searchPlaceholder="Search conversations"
          dimensions={dimensions}
          selected={selected}
          onSelect={onSelect}
          filterAriaLabel="Filter conversations"
          tally={tally}
          empty={empty}
        />
      </div>
    </div>
  );
}

/** The status a row wears: what the agent needs first, what it did otherwise. */
function RunStatusWord({ status, run }: { status: WorkStatus; run: WorkspaceRun | null }) {
  if (run && waitingCount(run) > 0) return <StatusWord tone="attention" word="Needs you" />;
  return <StatusWord tone={RUN_STATUS_TONE[status]} word={RUN_STATUS_META[status].word} />;
}

/** One conversation: the header this page owns, the flow underneath it. */
function ConversationRoute({ runId }: { runId: string }) {
  const [run, setRun] = useState<WorkspaceRun | null>(null);
  const [missing, setMissing] = useState(false);
  const starter = useRunTrigger(run?.repo?.id ?? '');

  // Signals arrive faster than reads answer while a run is busy. One read is in
  // flight at a time; a signal that lands meanwhile is remembered and served by
  // ONE follow-up read, so what is shown is always the newest answer.
  const reading = useRef(false);
  const again = useRef(false);
  const read = useCallback(async () => {
    if (reading.current) {
      again.current = true;
      return;
    }
    reading.current = true;
    try {
      do {
        again.current = false;
        try {
          const res = await getWorkspaceRun(runId);
          setRun(res.run);
          setMissing(false);
        } catch {
          setMissing(true);
        }
      } while (again.current);
    } finally {
      reading.current = false;
    }
  }, [runId]);

  useEffect(() => {
    void read();
  }, [read]);

  // The header's own facts (status, how long it has been going) and the
  // checklist follow the repository's store writes; the flow below tails its
  // own stream.
  const repoId = run?.repo?.id;
  useEffect(() => {
    if (!repoId) return;
    const socket = connectSocket();
    const onChanged = (payload: { repoId: string }): void => {
      if (payload.repoId === repoId) void read();
    };
    socket.on('session:runs-changed', onChanged);
    return () => {
      socket.off('session:runs-changed', onChanged);
    };
  }, [repoId, read]);

  // A run of the WORKSPACE (a Document scan) has no repository room at all, so
  // the shared stream is what moves this header: `run.changed` is one frame per
  // record write of THIS run, and the job frames bracket the hosted work around
  // it. Every one of them is a re-read of the record.
  useEffect(
    () =>
      subscribeToServerEvents((event) => {
        if (event.type === 'run.changed') {
          if (event.runId === runId) void read();
          return;
        }
        if (event.type === 'job.progress' || event.type === 'notification') void read();
      }),
    [read, runId],
  );

  if (missing) {
    return (
      <EmptyState
        icon={MousePointer2}
        title="No such conversation"
        body={
          <>
            Nothing of this workspace is at that address.{' '}
            <Link to={`${PREVIEW_BASE}/agent`} className="text-primary hover:underline">
              Open Agent
            </Link>
            .
          </>
        }
      />
    );
  }

  if (!run) return null;

  // Only a repository's work can be started again from here: the workspace's
  // own runs start on Context, which is where their subject lives.
  const canRerun = run.repo !== null && (run.status === 'failed' || run.status === 'interrupted');
  const canResume = run.command === 'guard-generate';

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        crumbs={[{ label: 'Agent', to: `${PREVIEW_BASE}/agent` }]}
        title={commandLabel(run.command)}
        right={
          <span className="flex items-center gap-3 text-[11px]">
            {run.repo && (
              <span className="font-mono text-muted-foreground">{run.repo.fullName}</span>
            )}
            <RunStatusWord status={run.status} run={run} />
            <span className="font-mono text-muted-foreground">{shortRef(run.gitRef)}</span>
            <RunElapsed run={run} />
            {canRerun && starter.supports(run.command) && (
              <button
                type="button"
                disabled={starter.pending}
                onClick={() => starter.start(run.command, canResume ? run.runId : undefined)}
                className="rounded border border-border px-2 py-0.5 font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
              >
                {starter.pending ? 'Starting…' : canResume ? 'Resume' : 'Run again'}
              </button>
            )}
          </span>
        }
      />
      <div className="flex min-h-0 flex-1">
        <RunConversationPage run={run} repoId={run.repo?.id ?? null} />
      </div>
    </div>
  );
}
