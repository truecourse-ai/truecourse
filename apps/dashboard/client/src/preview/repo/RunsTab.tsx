/**
 * Runs: a flat table of the repository's runs, newest first, the way
 * Repositories lists repositories. A row opens the run as its own page
 * (`/runs/:runId`, see ./RunPage.tsx), never a nested column. The search box
 * narrows by pull request number, commit or branch; there is no filter row,
 * because a list with one dimension does not earn one — Origin is a column.
 *
 * The rows are EVERY run the store holds, the baseline runs and the
 * pull-request head runs the gate wrote, re-read when a run of this repository
 * lands on the socket.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GuardHistoryEntry, GuardOutcome } from '@/preview/vendor/shared';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { HoverPopover } from '@/preview/ui/hover-popover';
import { GUARD_OUTCOMES, formatGuardTime } from '@/preview/vendor/lib/guard-drifts';
import { guardStatusMeta } from '@/preview/vendor/lib/guard-status';
import type { Repo } from '@/preview/data/types';
import { GenerateTestsAction } from './GenerateTestsAction';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';
import { useGuardRunList } from './use-guard-run-list';

function verdictOf(h: GuardHistoryEntry): GuardOutcome {
  return h.summary.fail > 0 || h.summary.error > 0 ? 'fail' : 'pass';
}

export function RunsTab({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const navigate = useNavigate();
  const reloadKey = useGuardRefresh(repo, ['guard-run']);
  const { runs: history, loading, error } = useGuardRunList(repo.id, reloadKey);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...history]
      .sort((a, b) => b.ranAt.localeCompare(a.ranAt))
      .filter(
        (h) =>
          !q ||
          (h.pullRequest != null && `#${h.pullRequest}`.includes(q)) ||
          (h.commit ?? '').toLowerCase().includes(q) ||
          (h.branch ?? '').toLowerCase().includes(q),
      );
  }, [history, query]);

  const openRun = (runId: string) => navigate(`/preview/repos/${repo.id}/runs/${encodeURIComponent(runId)}`);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Runs"
        subtitle={rows.length === history.length ? `${history.length}` : `${rows.length} of ${history.length}`}
        right={<GenerateTestsAction repo={repo} />}
      />
      <div className="min-w-0 shrink-0 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search runs"
          placeholder="Search runs (PR, commit, branch)"
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <table className="w-full min-w-4xl table-fixed border-collapse text-[13px]" aria-label="Runs">
          <colgroup>
            <col className="w-32" />
            <col />
            <col className="w-28" />
            <col className="w-20" />
            <col className="w-64" />
            <col className="w-52" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="whitespace-nowrap border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Commit</th>
              <th className="px-3 py-2 text-left font-semibold">Branch</th>
              <th className="px-3 py-2 text-left font-semibold">Pull request</th>
              <th className="px-3 py-2 text-left font-semibold">Origin</th>
              <th className="px-3 py-2 text-left font-semibold">Result</th>
              <th className="px-6 py-2 text-left font-semibold">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const verdict = verdictOf(h);
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
                  <td className="px-6 py-2.5 font-mono text-[12px] text-foreground">
                    <span className="block truncate" title={h.commit ?? h.runId}>{h.commit?.slice(0, 8) ?? h.runId}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-foreground">
                    <span className="block truncate" title={h.branch ?? ''}>{h.branch ?? ''}</span>
                  </td>
                  <td className="px-3 py-2.5 text-foreground">{h.pullRequest != null ? `#${h.pullRequest}` : ''}</td>
                  <td className="px-3 py-2.5">
                    <span className={CHIP_CLASS}>{h.origin ?? 'hosted'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground">
                        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${guardStatusMeta(verdict).dot}`} />
                        {verdict === 'fail' ? 'Failed' : 'Passed'}
                      </span>
                      <span className="inline-flex flex-wrap items-center gap-2 tabular-nums">
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
                  <td className="whitespace-nowrap px-6 py-2.5 text-muted-foreground">{formatGuardTime(h.ranAt)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                  {loading ? 'Loading runs.' : error ? error : history.length === 0 ? 'No run yet.' : 'No run matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
