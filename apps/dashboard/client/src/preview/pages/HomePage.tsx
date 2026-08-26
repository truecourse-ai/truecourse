/**
 * Home, for the product owner: the workspace's requirements and how much of
 * them is proven. The repository Coverage overview summed over every connected
 * repository (the same bars, the same five words), then one row per repository
 * with its own split and its last check, opening the repository's Coverage;
 * Connect repository is the page action. No feed, no jobs: gate activity lives
 * on a repository's Runs, jobs in Activity.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { GuardCoveragePlainStatus } from '@/preview/vendor/shared';
import { GUARD_COVERAGE_PLAIN_ORDER } from '@/preview/vendor/shared';
import { CompositionBar, fiveWordSegments } from '@/preview/vendor/components/guard/GuardCoverageOverview';
import { PageHeader, ProviderIcon } from '@/preview/ui/bits';
import { StatusWord, CONCLUSION_TONE } from '@/preview/ui/status-word';
import { statusSummary } from '@/preview/data/corpus-fixtures';
import { usePreviewState } from '@/preview/shell/preview-state';
import { ConnectDialog } from './ConnectDialog';

type ByStatus = Record<GuardCoveragePlainStatus, number>;

function zero(): ByStatus {
  return Object.fromEntries(GUARD_COVERAGE_PLAIN_ORDER.map((k) => [k, 0])) as ByStatus;
}

function add(into: ByStatus, from: ByStatus | undefined): void {
  if (!from) return;
  for (const k of GUARD_COVERAGE_PLAIN_ORDER) into[k] += from[k] ?? 0;
}

function proven(by: ByStatus): string {
  const total = GUARD_COVERAGE_PLAIN_ORDER.reduce((n, k) => n + by[k], 0);
  return total === 0 ? '' : `${Math.round((by.succeeded / total) * 100)}%`;
}

export default function HomePage() {
  const { workspace, repos } = usePreviewState();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectOpen, setConnectOpen] = useState(searchParams.get('connect') === '1');
  useEffect(() => {
    if (searchParams.get('connect') !== '1') return;
    const next = new URLSearchParams(searchParams);
    next.delete('connect');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const perRepo = useMemo(
    () =>
      repos.map((repo) => {
        const summary = statusSummary(repo.id);
        const sections = summary.sections?.byStatus ?? summary.coverage?.byStatus ?? zero();
        const flows = summary.coverage?.flows.byStatus ?? zero();
        return { repo, sections, flows, sectionTotal: summary.sections?.total ?? 0, withTests: summary.coverage?.withScenarios ?? 0 };
      }),
    [repos],
  );

  const totals = useMemo(() => {
    const sections = zero();
    const flows = zero();
    let sectionTotal = 0;
    for (const r of perRepo) {
      add(sections, r.sections);
      add(flows, r.flows);
      sectionTotal += r.sectionTotal;
    }
    return { sections, flows, sectionTotal };
  }, [perRepo]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title={workspace.name}
        subtitle={`${repos.length} repositories`}
        right={
          <button
            type="button"
            onClick={() => setConnectOpen(true)}
            className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Connect repository
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid grid-cols-1 gap-x-10 gap-y-5 border-b border-border px-6 py-5 lg:grid-cols-2">
          <CompositionBar label="Requirements" segments={fiveWordSegments(totals.sections)} totalLabel={`${totals.sectionTotal} sections · ${proven(totals.sections)} proven`} />
          <CompositionBar label="Flows" segments={fiveWordSegments(totals.flows)} />
        </div>

        <table className="w-full border-collapse text-[13px]" aria-label="Repositories by coverage">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Repository</th>
              <th className="px-3 py-2 text-left font-semibold">Requirements</th>
              <th className="px-3 py-2 text-right font-semibold">Proven</th>
              <th className="px-3 py-2 text-left font-semibold">Last check</th>
              <th className="px-6 py-2 text-left font-semibold">Baseline</th>
            </tr>
          </thead>
          <tbody>
            {perRepo.map(({ repo, sections, sectionTotal }) => {
              const segments = fiveWordSegments(sections).filter((s) => s.count > 0);
              return (
                <tr
                  key={repo.id}
                  tabIndex={0}
                  onClick={() => navigate(`/preview/repos/${repo.id}/coverage`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/preview/repos/${repo.id}/coverage`);
                  }}
                  className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                >
                  <td className="px-6 py-2.5">
                    <span className="flex items-center gap-2">
                      <ProviderIcon provider={repo.provider} />
                      <span className="text-foreground">{repo.fullName}</span>
                      {repo.onboarding && <span className="text-[11px] text-sky-600 dark:text-sky-400">onboarding</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {sectionTotal > 0 ? (
                      <span className="flex items-center gap-3">
                        <span
                          role="img"
                          aria-label={segments.map((s) => `${s.count} ${s.word.toLowerCase()}`).join(', ')}
                          className="flex h-2 w-40 gap-[2px] overflow-hidden rounded"
                        >
                          {segments.map((s) => (
                            <span key={s.word} className={`${s.fill} min-w-[3px]`} style={{ flexGrow: s.count, flexBasis: 0 }} />
                          ))}
                        </span>
                        <span className="inline-flex items-center gap-2 tabular-nums">
                          {segments.map((s) => (
                            <span key={s.word} className="inline-flex items-center gap-1 text-[10px] text-foreground">
                              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${s.fill}`} />
                              {s.count}
                            </span>
                          ))}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">no corpus yet</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{proven(sections)}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <StatusWord tone={CONCLUSION_TONE[repo.lastCheck.conclusion]} word={repo.lastCheck.word} />
                      <span className="text-muted-foreground">{repo.lastCheck.at}</span>
                    </span>
                  </td>
                  <td className="px-6 py-2.5 text-muted-foreground">
                    <span className="font-mono text-[12px] text-foreground">{repo.baselineSha}</span> · {repo.baselineAt}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
