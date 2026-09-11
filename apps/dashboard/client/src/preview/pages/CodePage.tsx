/**
 * Code: the repositories of the workspace, which is the engineer's reading of
 * it. The Coverage overview summed over every connected repository (the same
 * bars, the same five words), then one row per repository with its own split
 * and its last check, opening the repository's console; Connect repository is
 * the page action. No feed, no jobs: gate activity lives on a repository's
 * Runs, the agent's work on Agent.
 *
 * Every row reads its STORED summary from the server (the coverage split, the
 * last run's verdict, the corpus commit as its baseline), re-read when a run of
 * that repository completes.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { GuardCoveragePlainStatus, GuardLastRunSummary } from '@/preview/vendor/shared';
import type { Repo } from '@/preview/data/types';
import { GUARD_COVERAGE_PLAIN_ORDER } from '@/preview/vendor/shared';
import { fiveWordSegments } from '@/preview/vendor/components/guard/GuardCoverageOverview';
import { PageHeader, ProviderIcon } from '@/preview/ui/bits';
import { StatusWord, CONCLUSION_TONE } from '@/preview/ui/status-word';
import { usePreviewState } from '@/preview/shell/preview-state';
import { activityHref, relativeTime } from '@/preview/shell/real-runs';
import { ConnectDialog } from './ConnectDialog';
import { useRepoSummaries } from './use-repo-summaries';

type ByStatus = Record<GuardCoveragePlainStatus, number>;

function zero(): ByStatus {
  return Object.fromEntries(GUARD_COVERAGE_PLAIN_ORDER.map((k) => [k, 0])) as ByStatus;
}

function proven(by: ByStatus): string {
  const total = GUARD_COVERAGE_PLAIN_ORDER.reduce((n, k) => n + by[k], 0);
  return total === 0 ? '—' : `${Math.round((by.succeeded / total) * 100)}%`;
}

function checkForRun(run: GuardLastRunSummary): Repo['lastCheck'] {
  const counts = run.summary;
  const conclusion = counts.fail > 0 || counts.error > 0 ? 'failure'
    : counts.total > 0 && counts.pass === counts.total ? 'success' : 'neutral';
  return {
    conclusion,
    word: conclusion === 'failure' ? 'Failing' : conclusion === 'success' ? 'Passing' : 'Neutral',
    summary: `${counts.pass} passed, ${counts.fail} failed, ${counts.error} errors, ${counts.blocked ?? 0} blocked, ${counts.stale} stale, ${counts.orphaned} orphaned`,
    at: relativeTime(run.ranAt),
  };
}

export default function CodePage() {
  const { repos } = usePreviewState();
  const summaries = useRepoSummaries(repos);
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
        const loaded = summaries.get(repo.id);
        const summary = loaded?.status;
        const sections = summary?.sections?.byStatus ?? summary?.coverage?.byStatus ?? zero();
        const flows = summary?.coverage?.flows.byStatus ?? zero();
        const sectionTotal = summary?.sections?.total ?? summary?.coverage?.totalSections ?? 0;
        const lastRun = summary?.lastRun ?? null;
        const lastCheck = lastRun ? checkForRun(lastRun) : repo.lastCheck;
        const requirementsEmpty = !loaded ? 'Loading…'
          : loaded.statusError ? 'Coverage unavailable'
          : loaded.corpus || summary?.sections ? 'No requirements yet'
          : loaded.corpusError ? 'Requirements unavailable' : 'no corpus yet';
        return { repo, loaded, sections, flows, sectionTotal, lastCheck, lastRun, requirementsEmpty };
      }),
    [repos, summaries],
  );


  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Code"
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
            {perRepo.map(({ repo, loaded, sections, sectionTotal, lastCheck, lastRun, requirementsEmpty }) => {
              const segments = fiveWordSegments(sections).filter((s) => s.count > 0);
              return (
                <tr
                  key={repo.id}
                  tabIndex={0}
                  onClick={() => navigate(`/preview/repos/${repo.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) navigate(`/preview/repos/${repo.id}`);
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
                      <span className="text-muted-foreground">{requirementsEmpty}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{proven(sections)}</td>
                  <td className="px-3 py-2.5">
                    <Link
                      to={lastRun ? `/preview/repos/${repo.id}/runs` : activityHref(repo.id)}
                      onClick={(event) => event.stopPropagation()}
                      title={lastCheck.summary}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <StatusWord tone={CONCLUSION_TONE[lastCheck.conclusion]} word={lastCheck.word} />
                      <span className="text-muted-foreground">{lastCheck.at}</span>
                    </Link>
                  </td>
                  <td className="px-6 py-2.5 text-muted-foreground">
                    {!loaded ? 'Loading…' : loaded.corpusError ? 'Baseline unavailable' : loaded.corpus ? (
                      <>
                        <span title={loaded.corpus.corpusCommit} className="font-mono text-[12px] text-foreground">{loaded.corpus.corpusCommit?.slice(0, 7) ?? repo.defaultBranch}</span>
                        {' · '}{relativeTime(loaded.corpus.corpus.generatedAt)}
                      </>
                    ) : 'no baseline yet'}
                  </td>
                </tr>
              );
            })}
            {perRepo.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                  No repository connected yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
