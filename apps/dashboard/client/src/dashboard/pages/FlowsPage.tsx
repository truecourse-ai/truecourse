/**
 * Flows: every flow of every repository of the workspace, in one place, read
 * over '/api/repos/:id/guard/flows'.
 *
 * A flow is what the product proves, and it stopped being a tab of one
 * repository: the index keeps the platform's chrome (search full width, ONE
 * filter row of Add filter, dimension, value, the tally under the list) over
 * one table PER STATUS, worst news first, and a row opens the flow as its own
 * page at '/flows/:flowId?repo=<id>'.
 *
 * Each status has the columns its rows have something to say in. A failed flow
 * says what the product did instead of what its documents promise. Blocked
 * flows collapse to one row per thing they wait on, which opens to the flows
 * themselves: eighteen flows blocked on one missing key are one fact, not
 * eighteen. A thing only one flow waits on names that flow and opens it. The
 * rest say whether their test seeds its own data.
 *
 * Blocked flows are excluded unless Settings > Workspace or an explicit
 * blocked status filter includes them. Status, Document, Driver and Repository
 * live in the address (`?status=&doc=&driver=&repo=`),
 * so a narrowed page is a place: the repository console's jumps link straight
 * to `?repo=<id>`, and a run's flow link opens the flow itself.
 *
 * The list follows the work without a reload: a generate or a run landing on a
 * repository's socket re-reads it, and so does the workspace job stream — the
 * same two signals the Agent page listens to.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { GuardFlowListItem } from '@truecourse/shared';
import { guardDriver } from '@truecourse/shared';
import { connectSocket } from '@/lib/socket';
import { CHIP_CLASS, PageHeader } from '@/dashboard/ui/bits';
import { FilterBuilder, filterKey, selectedValues, type FilterDimension } from '@/dashboard/ui/filter-builder';
import { facetDimensions } from '@/dashboard/ui/filter-facets';
import { GUARD_COVERAGE_TONE, StatusTally, StatusWord, tallyOf } from '@/dashboard/ui/status-word';
import * as api from '@/lib/api';
import {
  GUARD_FLOW_STATUS_ORDER,
  GUARD_FLOW_STATUS_WORD,
  guardFlowPlainStatus,
  guardWhyNoTest,
  type GuardFlowPlainStatus,
} from '@/lib/guard-flow-status';
import type { Repo } from '@/dashboard/data/types';
import { useDashboardState } from '@/dashboard/shell/dashboard-state';
import { subscribeToServerEvents } from '@/dashboard/shell/event-stream';
import { FlowPage } from '@/dashboard/repo/FlowPage';
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

  useEffect(
    () =>
      subscribeToServerEvents((event) => {
        if (event.type === 'job.progress' || event.type === 'notification') nudge();
      }),
    [nudge],
  );

  return { rows: rows ?? [], loading: rows === null };
}

/** The filter dimensions, in the order the Add filter menu offers them. */
const DIMENSION_KEYS = ['status', 'doc', 'driver', 'repo'] as const;
type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** The URL parameter each dimension is spelled with. */
const PARAM: Record<DimensionKey, string> = { status: 'status', doc: 'doc', driver: 'driver', repo: 'repo' };

/** The documents a flow cites, as one cell: the first one's file name, and how many more. */
function documentCell(docs: readonly string[]): string {
  if (docs.length === 0) return '';
  const name = docs[0].split('/').pop() ?? docs[0];
  return docs.length === 1 ? name : `${name} +${docs.length - 1}`;
}

/**
 * What a blocked flow waits on, the phrase blocked flows group by: the few
 * words its test gave the missing thing, else the test's own explanation, else
 * what the flow's gap needs.
 */
function blockedReason({ flow }: FlowRow): string {
  return (
    flow.test?.blockedOn ??
    flow.test?.blockedBy ??
    guardWhyNoTest(flow.surfaces.find((surface) => surface.gap)?.gap, { attempted: flow.errors > 0 })
  );
}

const TABLE = 'w-full table-fixed border-collapse text-[13px]';
const HEAD_ROW = 'border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground';
const ROW = 'cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none';
const FIRST = 'truncate py-2.5 pl-6 pr-3';
const CELL = 'truncate px-3 py-2.5';
const LAST = 'truncate py-2.5 pl-3 pr-6 font-mono text-[12px] text-muted-foreground';

/** What makes a table row a door: a click, or Enter on it. */
function opening(open: () => void) {
  return {
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') open();
    },
  };
}

/** One status's table: the word and its count, then the rows under their own columns. */
function StatusGroup({
  status,
  count,
  columns,
  children,
}: {
  status: GuardFlowPlainStatus;
  count: number;
  /** Each column's heading and width; the first takes what the others leave. */
  columns: readonly { label: string; width?: string }[];
  children: ReactNode;
}) {
  return (
    <section aria-label={GUARD_FLOW_STATUS_WORD[status]}>
      <div className="px-6 pb-2 pt-5">
        <StatusWord tone={GUARD_COVERAGE_TONE[status]} word={GUARD_FLOW_STATUS_WORD[status]} count={count} />
      </div>
      <table className={TABLE} aria-label={`${GUARD_FLOW_STATUS_WORD[status]} flows`}>
        <thead>
          <tr className={HEAD_ROW}>
            {columns.map((column, i) => (
              <th
                key={column.label}
                {...(column.width ? { style: { width: column.width } } : {})}
                className={`truncate py-2 text-left font-semibold ${i === 0 ? 'pl-6 pr-3' : i === columns.length - 1 ? 'pl-3 pr-6' : 'px-3'}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

/** A flow's name as a first cell, with the mark a hand-written one wears. */
function FlowName({ flow }: { flow: GuardFlowListItem }) {
  return (
    <span className="flex items-center gap-2 text-foreground">
      <span className="min-w-0 truncate">{flow.title}</span>
      {flow.manual && <span className={CHIP_CLASS}>hand-written</span>}
    </span>
  );
}

export default function FlowsPage({ flowId }: { flowId?: string }) {
  return flowId ? <FlowRoute flowId={flowId} /> : <FlowsIndex />;
}

function FlowsIndex() {
  const navigate = useNavigate();
  const { repos, showBlocked: includeBlocked } = useDashboardState();
  const { rows: all, loading } = useWorkspaceFlows(repos);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const showBlocked = includeBlocked || params.getAll('status').includes('blocked');
  const visible = useMemo(() => all.filter((r) => showBlocked || guardFlowPlainStatus(r.flow) !== 'blocked'), [all, showBlocked]);

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

  const matchesQuery = useCallback(
    (r: FlowRow) => {
      const q = query.trim().toLowerCase();
      return q === '' || r.flow.title.toLowerCase().includes(q);
    },
    [query],
  );

  const rows = useMemo(() => {
    const statuses = selectedValues(selected, 'status');
    const docs = selectedValues(selected, 'doc');
    const drivers = selectedValues(selected, 'driver');
    const repoIds = selectedValues(selected, 'repo');
    return visible.filter(
      (r) =>
        matchesQuery(r) &&
        (statuses.length === 0 || statuses.includes(guardFlowPlainStatus(r.flow))) &&
        (docs.length === 0 || r.flow.docs.some((d) => docs.includes(d))) &&
        (drivers.length === 0 || (r.flow.drivers ?? []).some((d) => drivers.includes(d))) &&
        (repoIds.length === 0 || repoIds.includes(r.repo.id)),
    );
  }, [visible, matchesQuery, selected]);

  const tally = useMemo(
    () =>
      tallyOf(rows, GUARD_FLOW_STATUS_ORDER, (r) => guardFlowPlainStatus(r.flow), (status) => ({
        word: GUARD_FLOW_STATUS_WORD[status],
        tone: GUARD_COVERAGE_TONE[status],
      })),
    [rows],
  );

  const dimensions = useMemo<FilterDimension[]>(() => {
    const drivers = [...new Set(all.flatMap((r) => r.flow.drivers ?? []))];
    const docs = [...new Set(all.flatMap((r) => r.flow.docs))].sort();
    return facetDimensions<FlowRow>({
      rows: all,
      selected,
      matches: matchesQuery,
      dimensions: [
        {
          key: 'status',
          label: 'Status',
          valuesOf: (r) => [guardFlowPlainStatus(r.flow)],
          values: GUARD_FLOW_STATUS_ORDER.map((status) => ({
            value: status,
            label: GUARD_FLOW_STATUS_WORD[status],
          })),
          hideEmpty: true,
        },
        {
          key: 'doc',
          label: 'Document',
          valuesOf: (r) => r.flow.docs,
          values: docs.map((doc) => ({ value: doc, label: doc })),
          hideEmpty: true,
        },
        {
          key: 'driver',
          label: 'Driver',
          valuesOf: (r) => r.flow.drivers ?? [],
          values: drivers.map((driver) => ({
            value: driver,
            label: guardDriver(driver)?.label ?? driver,
          })),
          hideEmpty: true,
        },
        {
          key: 'repo',
          label: 'Repository',
          valuesOf: (r) => [r.repo.id],
          values: repos.map((repo) => ({ value: repo.id, label: repo.fullName })),
          hideEmpty: true,
        },
      ],
    });
  }, [all, matchesQuery, repos, selected]);

  /** The shown rows by status, each status's by title. */
  const byStatus = useMemo(() => {
    const groups = new Map<GuardFlowPlainStatus, FlowRow[]>();
    for (const row of rows) {
      const status = guardFlowPlainStatus(row.flow);
      groups.set(status, [...(groups.get(status) ?? []), row]);
    }
    for (const group of groups.values()) group.sort((a, b) => a.flow.title.localeCompare(b.flow.title));
    return groups;
  }, [rows]);

  /** The blocked rows by what they wait on, most flows first. */
  const blockedOn = useMemo(() => {
    const reasons = new Map<string, FlowRow[]>();
    for (const row of byStatus.get('blocked') ?? []) {
      const reason = blockedReason(row);
      reasons.set(reason, [...(reasons.get(reason) ?? []), row]);
    }
    return [...reasons].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [byStatus]);
  /** The reasons whose flows are listed under them. */
  const [openReasons, setOpenReasons] = useState<ReadonlySet<string>>(new Set());
  const toggleReason = (reason: string): void =>
    setOpenReasons((prev) => {
      const next = new Set(prev);
      if (!next.delete(reason)) next.add(reason);
      return next;
    });

  const open = ({ repo, flow }: FlowRow): void => {
    void navigate(flowHref(flow.flowId, repo.id));
  };
  const idOf = ({ repo, flow }: FlowRow): string => `${repo.id}:${flow.flowId}`;

  const narrowed = query.trim() !== '' || selected.length > 0 || (!showBlocked && all.length > 0);
  const empty = loading ? (
    'Loading…'
  ) : narrowed ? (
    'Nothing matches.'
  ) : (
    <>
      No flow generated yet. Generation shows up on{' '}
      <Link to={'/agent'} className="text-primary hover:underline">
        Agent
      </Link>
      .
    </>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Flows" />
      {!showBlocked && <p className="px-6 py-2 text-xs text-muted-foreground">Excluding blocked flows</p>}
      <div className="border-b border-border px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search flows"
          placeholder="Search flows"
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <FilterBuilder label="Filter" ariaLabel="Filter flows" dimensions={dimensions} selected={selected} onChange={onSelect} />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-6">
        {rows.length === 0 && <p className="px-6 py-8 text-center text-[13px] text-muted-foreground">{empty}</p>}
        {GUARD_FLOW_STATUS_ORDER.map((status) => {
          const group = byStatus.get(status) ?? [];
          if (group.length === 0) return null;
          if (status === 'failed') {
            return (
              <StatusGroup
                key={status}
                status={status}
                count={group.length}
                columns={[{ label: 'Flow', width: '28%' }, { label: 'Observed' }, { label: 'Document', width: '14rem' }]}
              >
                {group.map((row) => (
                  <tr key={idOf(row)} {...opening(() => open(row))} className={ROW}>
                    <td className={FIRST}>
                      <FlowName flow={row.flow} />
                    </td>
                    <td className={`${CELL} text-foreground`} title={row.flow.test?.observed}>
                      {row.flow.test?.observed ?? ''}
                    </td>
                    <td className={LAST}>{documentCell(row.flow.docs)}</td>
                  </tr>
                ))}
              </StatusGroup>
            );
          }
          if (status === 'blocked') {
            return (
              <StatusGroup
                key={status}
                status={status}
                count={group.length}
                columns={[{ label: 'Blocked on' }, { label: 'Flows', width: '14rem' }]}
              >
                {blockedOn.map(([reason, flows]) => (
                  <Fragment key={reason}>
                    {flows.length === 1 ? (
                      <tr {...opening(() => open(flows[0]))} className={ROW}>
                        <td className={`${FIRST} text-foreground`} title={reason}>
                          {reason}
                        </td>
                        <td className="truncate py-2.5 pl-3 pr-6" title={flows[0].flow.title}>
                          <FlowName flow={flows[0].flow} />
                        </td>
                      </tr>
                    ) : (
                      <tr {...opening(() => toggleReason(reason))} aria-expanded={openReasons.has(reason)} className={ROW}>
                        <td className={`${FIRST} text-foreground`} title={reason}>
                          {reason}
                        </td>
                        <td className="truncate py-2.5 pl-3 pr-6 tabular-nums text-foreground">{flows.length} flows</td>
                      </tr>
                    )}
                    {flows.length > 1 &&
                      openReasons.has(reason) &&
                      flows.map((row) => (
                        <tr key={idOf(row)} {...opening(() => open(row))} className={ROW}>
                          <td className="truncate py-2 pl-10 pr-3">
                            <FlowName flow={row.flow} />
                          </td>
                          <td className={LAST}>{documentCell(row.flow.docs)}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </StatusGroup>
            );
          }
          return (
            <StatusGroup
              key={status}
              status={status}
              count={group.length}
              columns={[{ label: 'Flow' }, { label: 'Data', width: '8rem' }, { label: 'Document', width: '14rem' }]}
            >
              {group.map((row) => (
                <tr key={idOf(row)} {...opening(() => open(row))} className={ROW}>
                  <td className={FIRST}>
                    <FlowName flow={row.flow} />
                  </td>
                  <td className={`${CELL} text-muted-foreground`}>{row.flow.test?.seeded ? 'Seeded' : ''}</td>
                  <td className={LAST}>{documentCell(row.flow.docs)}</td>
                </tr>
              ))}
            </StatusGroup>
          );
        })}
      </div>
      <StatusTally label="Flows" items={tally} total={visible.length} />
    </div>
  );
}

/** ONE flow, read through the repository `?repo=` names. */
function FlowRoute({ flowId }: { flowId: string }) {
  const [params] = useSearchParams();
  const { repos } = useDashboardState();
  const asked = params.get('repo');
  const repo = repos.find((r) => r.id === asked) ?? null;
  if (!repo) return null;
  return <FlowPage repo={repo} flowId={flowId} />;
}
