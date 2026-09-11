// PREVIEW: REAL for a connected repository — the flows its generate stored,
// read over `/api/repos/:id/guard/flows`. A fixture repository contributes its
// fixtures through the preview's fetch shim, exactly as the console's table did.

/**
 * Flows: every flow of every repository of the workspace, in one place.
 *
 * A flow is what the product proves, and it stopped being a tab of one
 * repository: the index is the platform's index shape (search full width, ONE
 * filter row of Add filter, dimension, value, then a one-line table), and a row
 * opens the flow as its own page at `/preview/flows/:flowId?repo=<id>`.
 *
 * Status, Driver and Repository live in the address (`?status=&driver=&repo=`),
 * so a narrowed page is a place: the repository console's jumps link straight
 * to `?repo=<id>`, and a run's flow link opens the flow itself.
 *
 * The list follows the work without a reload: a generate or a run landing on a
 * repository's socket re-reads it, and so does the workspace job stream — the
 * same two signals the Agent page listens to.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { GuardFlowListItem } from '@/preview/vendor/shared';
import { guardDriver } from '@/preview/vendor/shared';
import { getServerUrl } from '@/lib/server-url';
import { connectSocket } from '@/lib/socket';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { filterKey, selectedValues, type FilterDimension } from '@/preview/ui/filter-builder';
import { IndexTable, type IndexColumn } from '@/preview/ui/index-table';
import { GuardFlowStatusChip } from '@/preview/vendor/components/guard/GuardStatusBadge';
import * as api from '@/preview/vendor/lib/api';
import {
  GUARD_FLOW_STATUS_ORDER,
  GUARD_FLOW_STATUS_WORD,
  guardFlowPlainStatus,
} from '@/preview/vendor/lib/guard-flow-status';
import type { Repo } from '@/preview/data/types';
import { usePreviewState } from '@/preview/shell/preview-state';
import { PREVIEW_BASE } from '@/preview/shell/base';
import { FlowPage } from '@/preview/repo/FlowPage';
import { flowHref } from './flow-hrefs';

/** One row: a flow, and the repository it belongs to. */
interface FlowRow {
  flow: GuardFlowListItem;
  repo: Repo;
}

/** How long a live signal waits for its neighbours before the lists are re-read. */
const DEBOUNCE_MS = 500;

/** The guard jobs whose landing changes what a flow row says. */
const WATCHED_KINDS = new Set(['guard-generate', 'guard-run']);

/**
 * Every repository's flows, read once each and re-read when the work moves. A
 * repository that answers nothing contributes nothing rather than an error:
 * one unreadable repository must not empty the workspace's list.
 */
function useWorkspaceFlows(repos: Repo[]): { rows: FlowRow[]; loading: boolean } {
  const [rows, setRows] = useState<FlowRow[] | null>(null);
  const idsKey = repos.map((r) => r.id).join('|');
  const byId = useRef(new Map<string, Repo>());
  byId.current = new Map(repos.map((r) => [r.id, r]));

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    const ids = idsKey === '' ? [] : idsKey.split('|');
    const all = await Promise.all(
      ids.map(async (id): Promise<FlowRow[]> => {
        const repo = byId.current.get(id);
        if (!repo) return [];
        try {
          const view = await api.getGuardFlows(id);
          return (view?.flows ?? []).map((flow) => ({ flow, repo }));
        } catch {
          return [];
        }
      }),
    );
    if (alive.current) setRows(all.flat());
  }, [idsKey]);

  useEffect(() => {
    void read();
  }, [read]);

  // One debounced re-read behind both live signals.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudge = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void read();
    }, DEBOUNCE_MS);
  }, [read]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    let socket: ReturnType<typeof connectSocket> | null = null;
    const onComplete = (payload: { kind?: string }): void => {
      if (payload.kind && WATCHED_KINDS.has(payload.kind)) nudge();
    };
    try {
      socket = connectSocket();
      socket.on('spec:complete', onComplete);
    } catch {
      socket = null; // no socket transport here — the page still reads once
    }
    return () => {
      socket?.off('spec:complete', onComplete);
    };
  }, [nudge]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    try {
      source = new EventSource(`${getServerUrl()}/api/events`, { withCredentials: true });
    } catch {
      return;
    }
    const onMessage = (e: MessageEvent<string>): void => {
      try {
        const event = JSON.parse(e.data) as { type?: string };
        if (event.type === 'job.progress' || event.type === 'notification') nudge();
      } catch {
        // A frame this client has no reading of changes nothing.
      }
    };
    source.addEventListener('message', onMessage);
    const stream = source;
    return () => {
      stream.removeEventListener('message', onMessage);
      stream.close();
    };
  }, [nudge]);

  return { rows: rows ?? [], loading: rows === null };
}

/** The filter dimensions, in the order the Add filter menu offers them. */
const DIMENSION_KEYS = ['status', 'driver', 'repo'] as const;
type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** The URL parameter each dimension is spelled with. */
const PARAM: Record<DimensionKey, string> = { status: 'status', driver: 'driver', repo: 'repo' };

export default function FlowsPage({ flowId }: { flowId?: string }) {
  return flowId ? <FlowRoute flowId={flowId} /> : <FlowsIndex />;
}

function FlowsIndex() {
  const navigate = useNavigate();
  const { repos } = usePreviewState();
  const { rows: all, loading } = useWorkspaceFlows(repos);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => DIMENSION_KEYS.flatMap((d) => params.getAll(PARAM[d]).map((value) => filterKey(d, value))),
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
    const q = query.trim().toLowerCase();
    const statuses = selectedValues(selected, 'status');
    const drivers = selectedValues(selected, 'driver');
    const repoIds = selectedValues(selected, 'repo');
    return all.filter(
      (r) =>
        (q === '' || r.flow.title.toLowerCase().includes(q)) &&
        (statuses.length === 0 || statuses.includes(guardFlowPlainStatus(r.flow))) &&
        (drivers.length === 0 || (r.flow.drivers ?? []).some((d) => drivers.includes(d))) &&
        (repoIds.length === 0 || repoIds.includes(r.repo.id)),
    );
  }, [all, query, selected]);

  const dimensions = useMemo<FilterDimension[]>(() => {
    const drivers = new Map<string, number>();
    for (const r of all) for (const d of r.flow.drivers ?? []) drivers.set(d, (drivers.get(d) ?? 0) + 1);
    return [
      {
        key: 'status',
        label: 'Status',
        options: GUARD_FLOW_STATUS_ORDER.map((key) => ({
          key: filterKey('status', key),
          label: GUARD_FLOW_STATUS_WORD[key],
          count: all.filter((r) => guardFlowPlainStatus(r.flow) === key).length,
        })).filter((o) => o.count > 0),
      },
      {
        key: 'driver',
        label: 'Driver',
        options: [...drivers.entries()].map(([key, count]) => ({
          key: filterKey('driver', key),
          label: guardDriver(key)?.label ?? key,
          count,
        })),
      },
      {
        key: 'repo',
        label: 'Repository',
        options: repos
          .map((repo) => ({
            key: filterKey('repo', repo.id),
            label: repo.fullName,
            count: all.filter((r) => r.repo.id === repo.id).length,
          }))
          .filter((o) => o.count > 0),
      },
    ];
  }, [all, repos]);

  const columns = useMemo<IndexColumn<FlowRow>[]>(
    () => [
      {
        key: 'flow',
        label: 'Flow',
        cell: ({ flow }) => (
          <span className="flex items-center gap-2 text-foreground">
            <span className="min-w-0 truncate">{flow.title}</span>
            {flow.manual && <span className={CHIP_CLASS}>hand-written</span>}
          </span>
        ),
      },
      { key: 'status', label: 'Status', width: '7rem', cell: ({ flow }) => <GuardFlowStatusChip status={guardFlowPlainStatus(flow)} /> },
      {
        key: 'drivers',
        label: 'Drivers', width: '8rem', wrap: true,
        cell: ({ flow }) => (
          <span className="flex flex-wrap gap-1">
            {(flow.drivers ?? []).map((d) => (
              <span key={d} className={CHIP_CLASS}>
                {guardDriver(d)?.label ?? d}
              </span>
            ))}
          </span>
        ),
      },
      {
        key: 'repository',
        label: 'Repository', width: '14rem',
        className: 'font-mono text-[12px] text-muted-foreground',
        cell: ({ repo }) => repo.fullName,
      },
      {
        key: 'sections',
        label: 'Sections', width: '7.5rem',
        align: 'right',
        className: 'text-foreground',
        // The sections this flow covers, when it binds any: a flow bound to
        // nothing says nothing rather than a zero.
        cell: ({ flow }) => (flow.sectionCount > 0 ? flow.sectionCount : ''),
      },
    ],
    [],
  );

  const narrowed = query.trim() !== '' || selected.length > 0;
  const empty = loading ? (
    'Loading…'
  ) : narrowed ? (
    'Nothing matches.'
  ) : (
    <>
      No flow generated yet. Generation shows up on{' '}
      <Link to={`${PREVIEW_BASE}/agent`} className="text-primary hover:underline">
        Agent
      </Link>
      .
    </>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Flows" />
      <div className="min-h-0 flex-1">
        <IndexTable
          label="Flows"
          rows={rows}
          rowId={({ repo, flow }) => `${repo.id}:${flow.flowId}`}
          columns={columns}
          onOpen={({ repo, flow }) => navigate(flowHref(flow.flowId, repo.id))}
          query={query}
          onQuery={setQuery}
          searchPlaceholder="Search flows"
          dimensions={dimensions}
          selected={selected}
          onSelect={onSelect}
          filterAriaLabel="Filter flows"
          empty={empty}
        />
      </div>
    </div>
  );
}

/** ONE flow, read through the repository `?repo=` names. */
function FlowRoute({ flowId }: { flowId: string }) {
  const [params] = useSearchParams();
  const { repos } = usePreviewState();
  const asked = params.get('repo');
  const repo = repos.find((r) => r.id === asked) ?? null;
  if (!repo) return null;
  return <FlowPage repo={repo} flowId={flowId} />;
}
