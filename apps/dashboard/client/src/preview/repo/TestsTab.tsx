// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * Tests: a flat table of the repository's tests, the way Repositories lists
 * repositories. A row opens the test as its own page (`/tests/:flowId`, see
 * ./TestPage.tsx), never a nested column. Search by title; Status and Driver are
 * the filters.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { GuardFlowListItem } from '@/preview/vendor/shared';
import { guardDriver } from '@/preview/vendor/shared';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { FilterBar } from '@/preview/ui/filter-bar';
import { GuardFlowStatusChip } from '@/preview/vendor/components/guard/GuardStatusBadge';
import { useGuardDecisions } from '@/preview/vendor/hooks/useGuardDecisions';
import { useGuardFlows } from '@/preview/vendor/hooks/useGuardFlows';
import { GUARD_FLOW_STATUS_ORDER, GUARD_FLOW_STATUS_WORD, guardFlowPlainStatus } from '@/preview/vendor/lib/guard-flow-status';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';

export function TestsTab({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const navigate = useNavigate();
  // A jump that names a flow (`?flow=`, from a coverage section or an interface)
  // lands on that test's page: the table is the index, the page is the test.
  const [params] = useSearchParams();
  const jumpTo = params.get('flow');
  useEffect(() => {
    if (jumpTo) navigate(`/preview/repos/${repo.id}/tests/${encodeURIComponent(jumpTo)}`, { replace: true });
  }, [jumpTo, navigate, repo.id]);
  const flows = useGuardFlows(repo.id, true);
  const decisions = useGuardDecisions(repo.id, true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [driverFilter, setDriverFilter] = useState<string[]>([]);

  const all: GuardFlowListItem[] = useMemo(() => flows.view?.flows ?? [], [flows.view]);

  const statusOptions = useMemo(
    () =>
      GUARD_FLOW_STATUS_ORDER.map((key) => ({
        key,
        label: GUARD_FLOW_STATUS_WORD[key],
        count: all.filter((f) => guardFlowPlainStatus(f) === key).length,
      })).filter((o) => o.count > 0),
    [all],
  );
  const driverOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of all) for (const d of f.drivers ?? []) counts.set(d, (counts.get(d) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: guardDriver(key)?.label ?? key, count }));
  }, [all]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (f) =>
        (!q || f.title.toLowerCase().includes(q)) &&
        (statusFilter.length === 0 || statusFilter.includes(guardFlowPlainStatus(f))) &&
        (driverFilter.length === 0 || (f.drivers ?? []).some((d) => driverFilter.includes(d))),
    );
  }, [all, query, statusFilter, driverFilter]);

  const openTest = (flowId: string) => navigate(`/preview/repos/${repo.id}/tests/${encodeURIComponent(flowId)}`);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Tests" subtitle={rows.length === all.length ? `${all.length}` : `${rows.length} of ${all.length}`} />
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tests"
          placeholder="Search tests"
          className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center gap-x-4 [&>div]:border-0 [&>div]:px-0 [&>div]:py-0">
          <FilterBar
            label="Status"
            ariaLabel="Filter tests by status"
            options={statusOptions}
            selected={statusFilter}
            onChange={setStatusFilter}
            multi
          />
          <FilterBar
            label="Driver"
            ariaLabel="Filter by driver"
            options={driverOptions}
            selected={driverFilter}
            onChange={setDriverFilter}
            multi
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]" aria-label="Tests">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Test</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">Drivers</th>
              <th className="px-3 py-2 text-right font-semibold">Sections</th>
              <th className="px-6 py-2 text-right font-semibold">Milestones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr
                key={f.flowId}
                tabIndex={0}
                onClick={() => openTest(f.flowId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openTest(f.flowId);
                }}
                className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
              >
                <td className="px-6 py-2.5 text-foreground">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate">{f.title}</span>
                    {decisions.dismissedFlowIds.has(f.flowId) && <span className={CHIP_CLASS}>dismissed</span>}
                    {f.manual && <span className={CHIP_CLASS}>hand-written</span>}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <GuardFlowStatusChip status={guardFlowPlainStatus(f)} />
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {(f.drivers ?? []).map((d) => (
                      <span key={d} className={CHIP_CLASS}>
                        {guardDriver(d)?.label ?? d}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{f.sectionCount}</td>
                <td className="px-6 py-2.5 text-right tabular-nums text-foreground">{f.milestoneCount}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                  {flows.loading ? 'Loading tests.' : 'No test matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
