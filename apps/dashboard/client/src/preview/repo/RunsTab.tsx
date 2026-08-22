// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * Runs: a flat table of the repository's runs, newest first, the way
 * Repositories lists repositories. A row opens the run as its own page
 * (`/runs/:runId`, see ./RunPage.tsx), never a nested column. The search box
 * narrows by pull request number, commit or branch; Origin is the one filter.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GuardHistoryEntry, GuardOutcome } from '@/preview/vendor/shared';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { FilterBar } from '@/preview/ui/filter-bar';
import { HoverPopover } from '@/preview/ui/hover-popover';
import { GUARD_OUTCOMES, formatGuardTime } from '@/preview/vendor/lib/guard-drifts';
import { guardStatusMeta } from '@/preview/vendor/lib/guard-status';
import { useGuardRuns } from '@/preview/vendor/hooks/useGuardRuns';
import { coverageVersionById } from '@/preview/data/corpus';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';

function verdictOf(h: GuardHistoryEntry): GuardOutcome {
  return h.summary.fail > 0 || h.summary.error > 0 ? 'fail' : 'pass';
}

export function RunsTab({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const navigate = useNavigate();
  const { history, loading } = useGuardRuns(repo.id, true);
  const [query, setQuery] = useState('');
  const [originFilter, setOriginFilter] = useState<string[]>([]);

  const originOptions = useMemo(
    () =>
      (['hosted', 'local'] as const)
        .map((key) => ({ key, label: key, count: history.filter((h) => (h.origin ?? 'hosted') === key).length }))
        .filter((o) => o.count > 0),
    [history],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...history]
      .sort((a, b) => b.ranAt.localeCompare(a.ranAt))
      .filter(
        (h) =>
          (originFilter.length === 0 || originFilter.includes(h.origin ?? 'hosted')) &&
          (!q ||
            (h.pullRequest != null && `#${h.pullRequest}`.includes(q)) ||
            (h.commit ?? '').toLowerCase().includes(q) ||
            (h.branch ?? '').toLowerCase().includes(q)),
      );
  }, [history, query, originFilter]);

  const openRun = (runId: string) => navigate(`/preview/repos/${repo.id}/runs/${encodeURIComponent(runId)}`);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Runs" subtitle={rows.length === history.length ? `${history.length}` : `${rows.length} of ${history.length}`} />
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search runs"
          placeholder="Search runs (PR, commit, branch)"
          className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center gap-x-4 [&>div]:border-0 [&>div]:px-0 [&>div]:py-0">
          <FilterBar
            label="Origin"
            ariaLabel="Filter runs by origin"
            options={originOptions}
            selected={originFilter}
            onChange={setOriginFilter}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]" aria-label="Runs">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Commit</th>
              <th className="px-3 py-2 text-left font-semibold">Branch</th>
              <th className="px-3 py-2 text-left font-semibold">Pull request</th>
              <th className="px-3 py-2 text-left font-semibold">Origin</th>
              <th className="px-3 py-2 text-left font-semibold">Result</th>
              <th className="px-3 py-2 text-left font-semibold">Coverage</th>
              <th className="px-6 py-2 text-left font-semibold">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const verdict = verdictOf(h);
              const version = h.coverageVersion ? coverageVersionById(repo.id, h.coverageVersion) : undefined;
              return (
                <tr
                  key={h.runId}
                  tabIndex={0}
                  onClick={() => openRun(h.runId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') openRun(h.runId);
                  }}
                  className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                >
                  <td className="px-6 py-2.5 font-mono text-[12px] text-foreground">{h.commit ?? h.runId}</td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-foreground">{h.branch ?? ''}</td>
                  <td className="px-3 py-2.5 text-foreground">{h.pullRequest != null ? `#${h.pullRequest}` : ''}</td>
                  <td className="px-3 py-2.5">
                    <span className={CHIP_CLASS}>{h.origin ?? 'hosted'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-3">
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground">
                        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${guardStatusMeta(verdict).dot}`} />
                        {verdict === 'fail' ? 'Failed' : 'Passed'}
                      </span>
                      <span className="inline-flex items-center gap-2 tabular-nums">
                        {GUARD_OUTCOMES.filter((o) => h.summary[o] > 0).map((o) => (
                          <HoverPopover key={o} portal width="narrow" content={`${h.summary[o]} ${guardStatusMeta(o).label}`}>
                            <span className="inline-flex items-center gap-1 text-[10px] text-foreground">
                              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${guardStatusMeta(o).dot}`} />
                              {h.summary[o]}
                            </span>
                          </HoverPopover>
                        ))}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{version ? `${version.label} · ${version.sha}` : ''}</td>
                  <td className="px-6 py-2.5 text-muted-foreground">{formatGuardTime(h.ranAt)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                  {loading ? 'Loading runs.' : 'No run matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

