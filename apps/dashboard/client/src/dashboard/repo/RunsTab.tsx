/**
 * Runs: the repository's runs, newest first, in the platform's index table —
 * the same component, and so the same resizable columns and the same refusal
 * to scroll sideways, as every other list in the product. A row opens the run
 * as its own page (`/runs/:runId`, see ./RunPage.tsx), never a nested column.
 * The search box narrows by pull request number, commit or branch; there is no
 * filter row, because a list with one dimension does not earn one — Origin is a
 * column. How many runs the list shows is its TALLY, at the bottom, by verdict,
 * never a number beside the title.
 *
 * The rows are EVERY run the store holds, each with the origin it ran from,
 * re-read when a run of this repository
 * lands on the socket — led by the run IN FLIGHT, which no store holds yet: the
 * workspace's own run job for this repository, on the branch the header names,
 * saying what step it is on. It hands over to the stored row the moment that
 * run lands, so one run is never two rows.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GuardHistoryEntry, JobView } from '@truecourse/shared';
import { RUN_STATUS_META } from '@/components/sessions/run-model';
import { CHIP_CLASS, PageHeader } from '@/dashboard/ui/bits';
import { HoverPopover } from '@/dashboard/ui/hover-popover';
import { IndexTable, type IndexColumn } from '@/dashboard/ui/index-table';
import {
  RUN_STATUS_TONE,
  StatusWord,
  tallyOf,
  type StatusTone,
} from '@/dashboard/ui/status-word';
import { GUARD_OUTCOMES, formatGuardTime } from '@/lib/guard-drifts';
import { guardStatusMeta } from '@/lib/guard-status';
import { useDashboardState } from '@/dashboard/shell/dashboard-state';
import { jobCommand, jobRepoFullName, waitingFact } from '@/dashboard/shell/use-active-jobs';
import { pullRequestHover, useRepoPullRequests } from '@/dashboard/shell/use-pull-requests';
import { offersPullRequests } from '@/dashboard/data/providers';
import type { Repo } from '@/dashboard/data/types';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';
import { guardRunVerdict, useGuardRunList } from './use-guard-run-list';

/** A run's verdict, bad news first: the order the rows and the tally read in. */
const VERDICTS = ['fail', 'pass'] as const;

const VERDICT_META: Record<(typeof VERDICTS)[number], { word: string; tone: StatusTone }> = {
  fail: { word: 'Failed', tone: 'failure' },
  pass: { word: 'Passed', tone: 'success' },
};

/** The run in flight, which no store holds: the job, as a row can read it. */
interface LiveRun {
  status: 'running' | 'queued';
  at: string;
  fact: string;
  branch: string;
}

/** One row: a stored run, or the one this repository is doing right now. */
type RunRow = { live: LiveRun; run?: never } | { live?: never; run: GuardHistoryEntry };

/** The search, over the three things a run is found by. */
function matchesQuery(
  run: { pullRequest?: number | null; commit?: string | null; branch?: string | null },
  q: string,
): boolean {
  return (
    q === '' ||
    (run.pullRequest != null && `#${run.pullRequest}`.includes(q)) ||
    (run.commit ?? '').toLowerCase().includes(q) ||
    (run.branch ?? '').toLowerCase().includes(q)
  );
}

/** What a job is doing now: the live step of its checklist, else its own line. */
function currentStep(job: JobView): string {
  return job.progress.steps?.find((step) => step.status === 'active')?.label ?? job.progress.message ?? '';
}

export function RunsTab({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const navigate = useNavigate();
  const reloadKey = useGuardRefresh(repo, ['guard-run']);
  const { runs: history, loading, error } = useGuardRunList(repo.id, reloadKey);
  const { activeJobs } = useDashboardState();
  const [query, setQuery] = useState('');
  // The pull requests behind the column's hover, from a provider that has them.
  const showPulls = offersPullRequests([repo]);
  const pulls = useRepoPullRequests(repo.id, showPulls, reloadKey);
  const pullsByNumber = useMemo(() => new Map(pulls.map((pr) => [pr.number, pr])), [pulls]);

  const stored = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...history]
      .sort((a, b) => b.ranAt.localeCompare(a.ranAt))
      .filter((h) => matchesQuery(h, q));
  }, [history, query]);

  // The run this repository is doing right now. A stored run at or after the
  // job's start IS the run it is writing, so the row steps aside for it rather
  // than doubling it while the job list catches up.
  const inFlight = useMemo<LiveRun | null>(() => {
    if (!matchesQuery({ branch: repo.defaultBranch }, query.trim().toLowerCase())) return null;
    const job = activeJobs.find(
      (j) => jobCommand(j) === 'guard-run' && jobRepoFullName(j) === repo.fullName,
    );
    if (!job) return null;
    const at = job.startedAt ?? job.createdAt;
    if (history.some((h) => Date.parse(h.ranAt) >= Date.parse(at))) return null;
    const status = job.status === 'running' ? 'running' : 'queued';
    return {
      status,
      at,
      fact: currentStep(job) || (status === 'queued' ? waitingFact(job, activeJobs) : ''),
      branch: repo.defaultBranch,
    };
  }, [activeJobs, history, query, repo.defaultBranch, repo.fullName]);

  const rows = useMemo<RunRow[]>(
    () => [...(inFlight ? [{ live: inFlight }] : []), ...stored.map((run) => ({ run }))],
    [inFlight, stored],
  );

  const tally = useMemo(
    () => tallyOf(stored, VERDICTS, guardRunVerdict, (verdict) => VERDICT_META[verdict]),
    [stored],
  );

  const columns = useMemo<IndexColumn<RunRow>[]>(
    () => [
      {
        key: 'commit',
        label: 'Commit',
        className: 'font-mono text-[12px] text-foreground',
        cell: (row) =>
          row.run ? (
            // The short hash reads; the full one stays for hover and search.
            <span className="block truncate" title={row.run.commit ?? row.run.runId}>
              {row.run.commit?.slice(0, 8) ?? row.run.runId}
            </span>
          ) : null,
      },
      {
        key: 'branch',
        label: 'Branch',
        width: '11rem',
        className: 'font-mono text-[12px] text-foreground',
        cell: (row) => row.live?.branch ?? row.run?.branch ?? '',
      },
      ...(showPulls
        ? [
            {
              key: 'pr',
              label: 'Pull request',
              width: '7rem',
              className: 'text-foreground',
              cell: (row: RunRow) => {
                if (row.run?.pullRequest == null) return '';
                const pr = pullsByNumber.get(row.run.pullRequest);
                const cell = <span>#{row.run.pullRequest}</span>;
                // The title and the head branch ride the number on hover.
                return pr ? (
                  <HoverPopover portal width="narrow" content={pullRequestHover(pr)}>
                    {cell}
                  </HoverPopover>
                ) : (
                  cell
                );
              },
            } satisfies IndexColumn<RunRow>,
          ]
        : []),
      {
        key: 'origin',
        label: 'Origin',
        width: '6rem',
        cell: (row) => <span className={CHIP_CLASS}>{row.run?.origin ?? 'hosted'}</span>,
      },
      {
        key: 'result',
        label: 'Result',
        width: '14rem',
        wrap: true,
        cell: (row) =>
          row.live ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusWord
                tone={RUN_STATUS_TONE[row.live.status]}
                word={RUN_STATUS_META[row.live.status].word}
              />
              <span className="min-w-0 truncate text-[10px] text-muted-foreground">{row.live.fact}</span>
            </span>
          ) : (
            <RunResult run={row.run} />
          ),
      },
      {
        key: 'when',
        label: 'When',
        width: '11rem',
        className: 'whitespace-nowrap text-muted-foreground',
        cell: (row) => formatGuardTime(row.live?.at ?? row.run!.ranAt),
      },
    ],
    [showPulls, pullsByNumber],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Runs" />
      <IndexTable<RunRow>
        label="Runs"
        rows={rows}
        rowId={(row) => row.run?.runId ?? 'in-flight'}
        columns={columns}
        onOpen={(row) => {
          if (row.run) navigate(`/repos/${repo.id}/runs/${encodeURIComponent(row.run.runId)}`);
        }}
        // The run in flight has no page of its own until it lands.
        openable={(row) => Boolean(row.run)}
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search runs (PR, commit, branch)"
        searchLabel="Search runs"
        tally={tally}
        total={history.length}
        empty={loading ? 'Loading runs.' : error ? error : history.length === 0 ? 'No run yet.' : 'No run matches.'}
      />
    </div>
  );
}

/** A stored run's verdict and the outcomes behind it, each hovering its word. */
function RunResult({ run }: { run: GuardHistoryEntry }) {
  const verdict = guardRunVerdict(run);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${guardStatusMeta(verdict).dot}`} />
        {VERDICT_META[verdict].word}
      </span>
      <span className="inline-flex flex-wrap items-center gap-2 tabular-nums">
        {GUARD_OUTCOMES.filter((o) => run.summary[o] > 0).map((o) => (
          <HoverPopover key={o} portal width="narrow" content={`${run.summary[o]} ${guardStatusMeta(o).label}`}>
            <span className="inline-flex items-center gap-1 text-[10px] text-foreground">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${guardStatusMeta(o).dot}`} />
              {run.summary[o]}
            </span>
          </HoverPopover>
        ))}
      </span>
    </span>
  );
}
