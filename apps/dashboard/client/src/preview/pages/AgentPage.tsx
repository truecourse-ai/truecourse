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
 * The conversation route owns the one-row header (the repository, the status,
 * the ref, how long it took, and Run again when the work ended badly) and
 * mounts the conversation itself below it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MousePointer2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { RunConversationPage } from '@/components/sessions/RunConversationPage';
import {
  RUN_STATUS_META,
  commandLabel,
  runDuration,
  shortRef,
  startedLabel,
  waitingCount,
  type RunStatus,
} from '@/components/sessions/run-model';
import { getWorkspaceRun, type WorkspaceRun } from '@/lib/api';
import { connectSocket } from '@/lib/socket';
import { PageHeader } from '@/preview/ui/bits';
import { filterKey, selectedValues, type FilterDimension } from '@/preview/ui/filter-builder';
import { IndexTable, type IndexColumn } from '@/preview/ui/index-table';
import { StatusWord, type StatusTone } from '@/preview/ui/status-word';
import { usePreviewState } from '@/preview/shell/preview-state';
import { useRunTrigger } from '@/preview/shell/use-run-trigger';
import { useWorkspaceRuns } from '@/preview/shell/use-workspace-runs';
import { conversationHref } from '@/preview/shell/real-runs';
import { PREVIEW_BASE } from '@/preview/shell/base';
import { subscribeToServerEvents } from '@/preview/shell/event-stream';

const STATUS_TONE: Record<RunStatus, StatusTone> = {
  running: 'running',
  completed: 'success',
  failed: 'failure',
  interrupted: 'attention',
};

const STATUSES = Object.keys(RUN_STATUS_META) as RunStatus[];

/** The filter dimensions, in the order the Add filter menu offers them. */
const DIMENSION_KEYS = ['kind', 'status', 'repo'] as const;
type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** The URL parameter each dimension is spelled with. */
const PARAM: Record<DimensionKey, string> = { kind: 'kind', status: 'status', repo: 'repo' };

export default function AgentPage({ runId }: { runId?: string }) {
  return runId ? <ConversationRoute runId={runId} /> : <AgentIndex />;
}

function AgentIndex() {
  const navigate = useNavigate();
  const { repos } = usePreviewState();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');

  const connected = repos;
  const repoIds = useMemo(() => connected.map((r) => r.id), [connected]);
  const { runs, error } = useWorkspaceRuns(repoIds);

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

  const rows = useMemo(() => {
    const all = runs ?? [];
    const q = query.trim().toLowerCase();
    const kinds = selectedValues(selected, 'kind');
    const statuses = selectedValues(selected, 'status');
    const pickedRepos = selectedValues(selected, 'repo');
    return all.filter(
      (run) =>
        (kinds.length === 0 || kinds.includes(run.command)) &&
        (statuses.length === 0 || statuses.includes(run.status)) &&
        (pickedRepos.length === 0 || (run.repo !== null && pickedRepos.includes(run.repo.id))) &&
        (q === '' ||
          commandLabel(run.command).toLowerCase().includes(q) ||
          (run.repo?.fullName.toLowerCase().includes(q) ?? false) ||
          run.gitRef.toLowerCase().includes(q)),
    );
  }, [runs, query, selected]);

  const dimensions = useMemo<FilterDimension[]>(() => {
    const all = runs ?? [];
    const commands = [...new Set(all.map((r) => r.command))].sort();
    return [
      {
        key: 'kind',
        label: 'Kind',
        options: commands.map((command) => ({
          key: filterKey('kind', command),
          label: commandLabel(command),
          count: all.filter((r) => r.command === command).length,
        })),
      },
      {
        key: 'status',
        label: 'Status',
        options: STATUSES.map((status) => ({
          key: filterKey('status', status),
          label: RUN_STATUS_META[status].word,
          count: all.filter((r) => r.status === status).length,
        })).filter((o) => o.count > 0),
      },
      {
        key: 'repo',
        label: 'Repository',
        options: connected.map((repo) => ({
          key: filterKey('repo', repo.id),
          label: repo.fullName,
          count: all.filter((r) => r.repo?.id === repo.id).length,
        })),
      },
    ];
  }, [runs, connected]);

  const columns = useMemo<IndexColumn<WorkspaceRun>[]>(
    () => [
      {
        key: 'conversation',
        label: 'Conversation',
        cell: (run) => <span className="text-foreground">{commandLabel(run.command)}</span>,
      },
      {
        key: 'repository',
        label: 'Repository', width: '14rem',
        className: 'font-mono text-[12px] text-muted-foreground',
        // The workspace's own work (a Document scan reads every source and
        // clones nothing) belongs to no repository, and says so.
        cell: (run) => run.repo?.fullName ?? '—',
      },
      { key: 'status', label: 'Status', width: '8rem', cell: (run) => <RunStatusWord run={run} /> },
      {
        key: 'started',
        label: 'Started', width: '10rem',
        className: 'text-muted-foreground',
        cell: (run) => startedLabel(run.startedAt),
      },
      {
        key: 'took',
        label: 'Took', width: '6rem',
        align: 'right',
        className: 'text-muted-foreground',
        cell: (run) => runDuration(run),
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
          rowId={(run) => run.runId}
          columns={columns}
          onOpen={(run) => navigate(conversationHref(run.runId))}
          query={query}
          onQuery={setQuery}
          searchPlaceholder="Search conversations"
          dimensions={dimensions}
          selected={selected}
          onSelect={onSelect}
          filterAriaLabel="Filter conversations"
          empty={empty}
        />
      </div>
    </div>
  );
}

/** The status a row wears: what the agent needs first, what it did otherwise. */
function RunStatusWord({ run }: { run: WorkspaceRun }) {
  if (waitingCount(run) > 0) return <StatusWord tone="attention" word="Needs you" />;
  return <StatusWord tone={STATUS_TONE[run.status]} word={RUN_STATUS_META[run.status].word} />;
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

  // A hosted job writes the record from the server side, and a run of the
  // WORKSPACE (a Document scan) has no repository room at all: the job stream
  // is the signal for both, and every tick of it is a re-read of the record.
  useEffect(
    () =>
      subscribeToServerEvents((event) => {
        if (event.type === 'job.progress' || event.type === 'notification') void read();
      }),
    [read],
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
            <RunStatusWord run={run} />
            <span className="font-mono text-muted-foreground">{shortRef(run.gitRef)}</span>
            <span className="tabular-nums text-muted-foreground">{runDuration(run)}</span>
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
