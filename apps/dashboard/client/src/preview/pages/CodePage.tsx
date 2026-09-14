/**
 * Code: the repositories of the workspace, which is the engineer's reading of
 * it. One row per repository with its own coverage split and its last check,
 * opening the repository's console, in the platform's index table — the same
 * resizable columns, and the same refusal to scroll sideways, as every other
 * list. Connect repository is the page action. No feed, no jobs: gate activity
 * lives on a repository's Runs, the agent's work on Agent.
 *
 * Every row reads its STORED summary from the server (the coverage split, the
 * last run's verdict, the corpus commit as its baseline), re-read when a run of
 * that repository completes.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { GuardCoveragePlainStatus, GuardLastRunSummary } from '@truecourse/shared';
import type { Repo } from '@/preview/data/types';
import { GUARD_COVERAGE_PLAIN_ORDER } from '@truecourse/shared';
import { fiveWordSegments } from '@/components/guard/GuardCoverageOverview';
import { PageHeader, ProviderIcon } from '@/preview/ui/bits';
import { IndexTable, type IndexColumn } from '@/preview/ui/index-table';
import { StatusWord, CONCLUSION_TONE, tallyOf } from '@/preview/ui/status-word';
import { usePreviewState } from '@/preview/shell/preview-state';
import { activityHref, relativeTime } from '@/preview/shell/real-runs';
import { ConnectDialog } from './ConnectDialog';
import { useRepoSummaries, type RepoSummary } from './use-repo-summaries';

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

/** What a repository's last check concluded, bad news first: the tally's order. */
const CONCLUSIONS = ['failure', 'success', 'neutral'] as const;

const CONCLUSION_WORD: Record<(typeof CONCLUSIONS)[number], string> = {
  failure: 'Failing',
  success: 'Passing',
  neutral: 'Neutral',
};

/** One row of the list: a repository, with everything its row reads. */
interface RepoRow {
  repo: Repo;
  loaded: RepoSummary | undefined;
  sections: ByStatus;
  sectionTotal: number;
  lastCheck: Repo['lastCheck'];
  lastRun: GuardLastRunSummary | null;
  requirementsEmpty: string;
}

export default function CodePage() {
  const { repos } = usePreviewState();
  const summaries = useRepoSummaries(repos);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectOpen, setConnectOpen] = useState(searchParams.get('connect') === '1');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (searchParams.get('connect') !== '1') return;
    setConnectOpen(true);
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
        return { repo, loaded, sections, sectionTotal, lastCheck, lastRun, requirementsEmpty };
      }),
    [repos, summaries],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? perRepo : perRepo.filter((r) => r.repo.fullName.toLowerCase().includes(q));
  }, [perRepo, query]);

  const tally = useMemo(
    () =>
      tallyOf(rows, CONCLUSIONS, (r) => r.lastCheck.conclusion, (conclusion) => ({
        word: CONCLUSION_WORD[conclusion],
        tone: CONCLUSION_TONE[conclusion],
      })),
    [rows],
  );

  const columns = useMemo<IndexColumn<RepoRow>[]>(
    () => [
      {
        key: 'repository',
        label: 'Repository',
        cell: ({ repo }) => (
          <span className="flex items-center gap-2">
            <ProviderIcon provider={repo.provider} />
            <span className="min-w-0 truncate text-foreground">{repo.fullName}</span>
            {repo.onboarding && (
              <span className="shrink-0 text-[11px] text-sky-600 dark:text-sky-400">onboarding</span>
            )}
          </span>
        ),
      },
      {
        key: 'requirements',
        label: 'Requirements',
        width: '22rem',
        wrap: true,
        cell: ({ sections, sectionTotal, requirementsEmpty }) => {
          if (sectionTotal === 0) return <span className="text-muted-foreground">{requirementsEmpty}</span>;
          const segments = fiveWordSegments(sections).filter((seg) => seg.count > 0);
          return (
            <span className="flex items-center gap-3">
              <span
                role="img"
                aria-label={segments.map((seg) => `${seg.count} ${seg.word.toLowerCase()}`).join(', ')}
                className="flex h-2 w-40 shrink-0 gap-[2px] overflow-hidden rounded"
              >
                {segments.map((seg) => (
                  <span
                    key={seg.word}
                    className={`${seg.fill} min-w-[3px]`}
                    style={{ flexGrow: seg.count, flexBasis: 0 }}
                  />
                ))}
              </span>
              <span className="inline-flex flex-wrap items-center gap-2 tabular-nums">
                {segments.map((seg) => (
                  <span key={seg.word} className="inline-flex items-center gap-1 text-[10px] text-foreground">
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${seg.fill}`} />
                    {seg.count}
                  </span>
                ))}
              </span>
            </span>
          );
        },
      },
      {
        key: 'proven',
        label: 'Proven',
        width: '6rem',
        align: 'right',
        className: 'text-foreground',
        cell: ({ sections }) => proven(sections),
      },
      {
        key: 'lastCheck',
        label: 'Last check',
        width: '14rem',
        cell: ({ repo, lastCheck, lastRun }) => (
          <Link
            to={lastRun ? `/repos/${repo.id}/runs` : activityHref(repo.id)}
            onClick={(event) => event.stopPropagation()}
            title={lastCheck.summary}
            className="flex items-center gap-2 hover:underline"
          >
            <StatusWord tone={CONCLUSION_TONE[lastCheck.conclusion]} word={lastCheck.word} />
            <span className="truncate text-muted-foreground">{lastCheck.at}</span>
          </Link>
        ),
      },
      {
        key: 'baseline',
        label: 'Baseline',
        width: '14rem',
        className: 'text-muted-foreground',
        cell: ({ repo, loaded }) =>
          !loaded ? 'Loading…' : loaded.corpusError ? 'Baseline unavailable' : loaded.corpus ? (
            <>
              <span className="font-mono text-[12px] text-foreground">{repo.defaultBranch}</span>
              {' \u00b7 '}
              {relativeTime(loaded.corpus.corpus.generatedAt)}
            </>
          ) : (
            'no baseline yet'
          ),
      },
    ],
    [],
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
      <IndexTable<RepoRow>
        label="Repositories by coverage"
        rows={rows}
        rowId={({ repo }) => repo.id}
        columns={columns}
        onOpen={({ repo }) => navigate(`/repos/${repo.id}`)}
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search repositories"
        tally={tally}
        total={perRepo.length}
        empty={perRepo.length === 0 ? 'No repository connected yet.' : 'No repository matches.'}
      />
      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
