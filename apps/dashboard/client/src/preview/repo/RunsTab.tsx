/**
 * Runs: a flat table of the repository's runs, newest first, the way
 * Repositories lists repositories. A row opens the run as its own page
 * (`/runs/:runId`, see ./RunPage.tsx), never a nested column. The search box
 * narrows by pull request number, commit or branch; there is no filter row,
 * because a list with one dimension does not earn one — Origin is a column.
 * How many runs the list shows is its TALLY, at the bottom, by verdict, never
 * a number beside the title.
 *
 * The rows are EVERY run the store holds, the baseline runs and the
 * pull-request head runs the gate wrote, re-read when a run of this repository
 * lands on the socket — led by the run IN FLIGHT, which no store holds yet: the
 * workspace's own run job for this repository, on the branch the header names,
 * saying what step it is on. It hands over to the stored row the moment that
 * run lands, so one run is never two rows.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JobView } from '@truecourse/shared';
import { RUN_STATUS_META } from '@/components/sessions/run-model';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { HoverPopover } from '@/preview/ui/hover-popover';
import {
  RUN_STATUS_TONE,
  StatusTally,
  StatusWord,
  tallyOf,
  type StatusTone,
} from '@/preview/ui/status-word';
import { GUARD_OUTCOMES, formatGuardTime } from '@/preview/vendor/lib/guard-drifts';
import { guardStatusMeta } from '@/preview/vendor/lib/guard-status';
import { usePreviewState } from '@/preview/shell/preview-state';
import { jobCommand, jobRepoFullName, waitingFact } from '@/preview/shell/use-active-jobs';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';
import { guardRunVerdict, useGuardRunList } from './use-guard-run-list';

/** A run's verdict, bad news first: the order the rows and the tally read in. */
const VERDICTS = ['fail', 'pass'] as const;

const VERDICT_META: Record<(typeof VERDICTS)[number], { word: string; tone: StatusTone }> = {
  fail: { word: 'Failed', tone: 'failure' },
  pass: { word: 'Passed', tone: 'success' },
};

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
  const { activeJobs } = usePreviewState();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...history]
      .sort((a, b) => b.ranAt.localeCompare(a.ranAt))
      .filter((h) => matchesQuery(h, q));
  }, [history, query]);

  // The run this repository is doing right now. A stored run at or after the
  // job's start IS the run it is writing, so the row steps aside for it rather
  // than doubling it while the job list catches up.
  const inFlight = useMemo(() => {
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
    } as const;
  }, [activeJobs, history, query, repo.defaultBranch, repo.fullName]);

  const tally = useMemo(
    () => tallyOf(rows, VERDICTS, guardRunVerdict, (verdict) => VERDICT_META[verdict]),
    [rows],
  );

  const openRun = (runId: string) => navigate(`/preview/repos/${repo.id}/runs/${encodeURIComponent(runId)}`);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Runs" />
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
            {inFlight && (
              <tr className="border-b border-border/60">
                <td className="px-6 py-2.5 font-mono text-[12px] text-muted-foreground" />
                <td className="px-3 py-2.5 font-mono text-[12px] text-foreground">
                  <span className="block truncate" title={inFlight.branch}>{inFlight.branch}</span>
                </td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5">
                  <span className={CHIP_CLASS}>hosted</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusWord
                      tone={RUN_STATUS_TONE[inFlight.status]}
                      word={RUN_STATUS_META[inFlight.status].word}
                    />
                    <span className="min-w-0 truncate text-[10px] text-muted-foreground">{inFlight.fact}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-2.5 text-muted-foreground">
                  {formatGuardTime(inFlight.at)}
                </td>
              </tr>
            )}
            {rows.map((h) => {
              const verdict = guardRunVerdict(h);
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
                        {VERDICT_META[verdict].word}
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
            {rows.length === 0 && !inFlight && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                  {loading ? 'Loading runs.' : error ? error : history.length === 0 ? 'No run yet.' : 'No run matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <StatusTally
        label="Runs"
        items={tally}
        total={history.length}
      />
    </div>
  );
}
