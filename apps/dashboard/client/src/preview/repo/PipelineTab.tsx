/**
 * Pipeline: the three pieces of work this repository runs, in the order they
 * chain. Setup derives what the tests need, generation writes them, and a run
 * executes them, so the three read as one column: what each last did, when, and
 * a way to start it again.
 *
 * Every row is what the server already stored — the repository's own agent runs
 * (`sessions/runs`, the list the Agent page reads), the setup report, the
 * generate report and the run history — and the row's word is that work's LAST
 * outcome, never a wish. A row opens what it is about: setup and generation open
 * their conversation, a run opens the run.
 *
 * The one word that is not an outcome is QUEUED: the heavy jobs of a workspace
 * run one at a time, so this repository's can be waiting its turn with nothing
 * to report yet. Then the row says what it waits for, and every Re-run waits
 * with it.
 *
 * Work in flight says which step it is on, off the run's own checklist, and its
 * is the one button that spins: the rows that merely wait for it are dead, not
 * busy.
 *
 * It re-reads on the same signals the Runs tab watches: a guard job settling on
 * this repository's room, and a run-store write while one is in flight.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RotateCw } from 'lucide-react';
import type { GuardSetupReport } from '@truecourse/shared';
import type { GuardGenerateReport, GuardHistoryEntry } from '@truecourse/shared';
import { Button } from '@/components/ui/button';
import { listSessionRuns, type PublicSessionRun } from '@/lib/api';
import { connectSocket } from '@/lib/socket';
import { RUN_STATUS_META, commandLabel, runChecklist } from '@/components/sessions/run-model';
import { useGuardGenerate } from '@/hooks/useGuardGenerate';
import * as api from '@/lib/api';
import { GUARD_OUTCOMES } from '@/lib/guard-drifts';
import { guardStatusMeta } from '@/lib/guard-status';
import { PageHeader } from '@/preview/ui/bits';
import {
  RUN_STATUS_TONE,
  StatusWord,
  VERDICT_TONE,
  VERDICT_WORD,
  type StatusTone,
} from '@/preview/ui/status-word';
import { usePreviewState } from '@/preview/shell/preview-state';
import { useRunTrigger } from '@/preview/shell/use-run-trigger';
import { jobCommand, jobRepoFullName, waitingFact } from '@/preview/shell/use-active-jobs';
import { activityHref, conversationHref, relativeTime } from '@/preview/shell/real-runs';
import type { Repo } from '@/preview/data/types';
import { useGuardRefresh } from './use-guard-refresh';
import { guardRunVerdict, useGuardRunList } from './use-guard-run-list';

const ROW = 'flex min-w-0 flex-1 flex-col gap-0.5 px-6 py-3 text-left transition-colors hover:bg-muted/30';

/** The commands the rows are about, in the order the work chains. */
const SETUP = 'guard-setup';
const GENERATE = 'guard-generate';
const RUN = 'guard-run';

/** Nothing of this kind has ever run here. */
const NEVER: { tone: StatusTone; word: string } = { tone: 'neutral', word: 'Never run' };

/** What setup left behind, in one line. */
function setupFact(report: GuardSetupReport | null): string {
  if (!report) return '';
  if (report.status === 'failed') return report.reason ?? 'The recipe gate did not hold';
  const steps = report.steps ?? [];
  if (steps.length === 0) return report.recipe.outcome === 'discovered' ? 'Recipe discovered' : 'Recipe in place';
  return `${steps.filter((s) => s.status === 'ok').length} of ${steps.length} steps settled`;
}

/** What the last generate wrote, and what it could not. */
function generateFact(report: GuardGenerateReport | null): string {
  if (!report) return '';
  if (report.status !== 'ok') return report.reason ?? 'Generation was stopped';
  return `${report.written.length} written, ${report.coverageGaps.length} blocked`;
}

/** The run's board, in the words its outcomes wear everywhere else. */
function runFact(entry: GuardHistoryEntry | null): string {
  if (!entry) return '';
  return GUARD_OUTCOMES.filter((o) => entry.summary[o] > 0)
    .map((o) => `${entry.summary[o]} ${guardStatusMeta(o).label.toLowerCase()}`)
    .join(', ');
}

/** What work in flight is doing right now: the live step of its own checklist. */
function stepFact(run: PublicSessionRun | null): string {
  if (!run || run.status !== 'running') return '';
  return runChecklist(run).find((item) => item.status === 'active')?.label ?? '';
}

/** The newest run of one command, or null when that work never ran here. */
function newest(runs: readonly PublicSessionRun[], command: string): PublicSessionRun | null {
  return (
    [...runs]
      .filter((run) => run.command === command)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
  );
}

/** Everything the three rows read, re-read on both live signals. */
function usePipeline(repo: Repo): {
  runs: PublicSessionRun[];
  setup: GuardSetupReport | null;
  report: GuardGenerateReport | null;
  history: GuardHistoryEntry[];
  loaded: boolean;
} {
  const settled = useGuardRefresh(repo, [SETUP, GENERATE, RUN]);
  // A run-store write while a job is in flight: the row follows the work, not
  // just its settlement.
  const [live, setLive] = useState(0);
  useEffect(() => {
    let socket: ReturnType<typeof connectSocket> | null = null;
    const onChanged = (payload: { repoId?: string }): void => {
      if (payload.repoId === repo.id) setLive((n) => n + 1);
    };
    try {
      socket = connectSocket();
      socket.on('session:runs-changed', onChanged);
    } catch {
      socket = null; // no socket transport here; the page still reads once
    }
    return () => {
      socket?.off('session:runs-changed', onChanged);
    };
  }, [repo.id]);

  const [runs, setRuns] = useState<PublicSessionRun[]>([]);
  const [setup, setSetup] = useState<GuardSetupReport | null>(null);
  const [report, setReport] = useState<GuardGenerateReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { runs: history } = useGuardRunList(repo.id, settled + live);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [sessionRuns, setupReport, generateReport] = await Promise.all([
        listSessionRuns(repo.id).then((r) => r.runs).catch(() => [] as PublicSessionRun[]),
        api.getGuardSetup(repo.id).catch(() => null),
        api.getGuardReport(repo.id).catch(() => null),
      ]);
      if (cancelled) return;
      setRuns(sessionRuns);
      setSetup(setupReport);
      setReport(generateReport);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo.id, settled, live]);

  return { runs, setup, report, history, loaded };
}

/**
 * One piece of work, in the four corners every row of the product wears: what
 * it is top-left, its word top-right, one fact bottom-left, when it was
 * bottom-right. The second line is there whether or not it has anything to
 * say, so the three rows are one height and the column does not step.
 *
 * The button spins on the row whose work is actually in flight. The others are
 * dead while the lane is busy and say so by being dead: a spinner on a row
 * that is not working reads as work that is not happening.
 */
function PipelineRow({
  title,
  tone,
  word,
  fact,
  at,
  verb,
  busy,
  working,
  onOpen,
  onRerun,
}: {
  title: string;
  tone: StatusTone;
  word: string;
  fact: string;
  at: string | null;
  /** "Run" the first time, "Re-run" once this work has a last time. */
  verb: string;
  busy: boolean;
  working: boolean;
  onOpen: () => void;
  onRerun: () => void;
}) {
  return (
    <li className="flex items-center gap-2 border-b border-border pr-6">
      <button type="button" onClick={onOpen} className={ROW}>
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{title}</span>
          <StatusWord tone={tone} word={word} />
        </span>
        <span className="flex min-h-4 w-full items-center gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{fact}</span>
          <span className="shrink-0">{at ? relativeTime(at) : ''}</span>
        </span>
      </button>
      <Button size="sm" variant="outline" disabled={busy} onClick={onRerun} aria-label={`${verb} ${title}`}>
        {working ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCw aria-hidden className="h-3.5 w-3.5" />
        )}
        {verb}
      </Button>
    </li>
  );
}

export function PipelineTab({ repo }: { repo: Repo }) {
  const navigate = useNavigate();
  const { runs, setup, report, history, loaded } = usePipeline(repo);
  const { jobs, jobsReady, activeJobs, activeJobsReady } = usePreviewState();
  const trigger = useRunTrigger(repo.id);
  const generate = useGuardGenerate(repo.id);

  // One heavy job at a time per repository: while this one is working, every
  // row's action waits with it — and a job that has not started is just as much
  // in flight as a running one, so it waits for those too.
  const activeJob =
    jobs.some((job) => job.repoFullName === repo.fullName) ||
    activeJobs.some((job) => jobRepoFullName(job) === repo.fullName);
  const busy =
    activeJob || trigger.pending || generate.busy || !jobsReady || !activeJobsReady;

  const openRun = useCallback(
    (run: PublicSessionRun | null) =>
      navigate(run ? conversationHref(run.runId) : activityHref(repo.id)),
    [navigate, repo.id],
  );

  const rows = useMemo(() => {
    const setupRun = newest(runs, SETUP);
    const generateRun = newest(runs, GENERATE);
    const runRun = newest(runs, RUN);
    const lastRun = [...history].sort((a, b) => b.ranAt.localeCompare(a.ranAt))[0] ?? null;
    const statusOf = (run: PublicSessionRun | null) =>
      run ? { tone: RUN_STATUS_TONE[run.status], word: RUN_STATUS_META[run.status].word } : NEVER;
    const verdict = lastRun ? (guardRunVerdict(lastRun) === 'fail' ? 'failed' : 'passed') : null;

    // Work that has not started has no run to read: the workspace's job list is
    // where it is visible, and the row says it is queued and what it waits for.
    const waiting = (command: string) => {
      const job = activeJobs.find(
        (j) => jobCommand(j) === command && jobRepoFullName(j) === repo.fullName,
      );
      if (!job || job.status !== 'queued') return null;
      return {
        tone: RUN_STATUS_TONE.queued,
        word: RUN_STATUS_META.queued.word,
        fact: waitingFact(job, activeJobs),
        at: job.createdAt,
      };
    };

    const chain = [
      {
        key: SETUP,
        title: commandLabel(SETUP),
        ...statusOf(setupRun),
        fact: stepFact(setupRun) || setupFact(setup),
        at: setupRun?.finishedAt ?? setupRun?.startedAt ?? setup?.ranAt ?? null,
        ran: Boolean(setupRun ?? setup),
        newestRun: setupRun,
        onOpen: () => openRun(setupRun),
        onRerun: () => trigger.start(SETUP),
      },
      {
        key: GENERATE,
        title: commandLabel(GENERATE),
        ...statusOf(generateRun),
        fact: stepFact(generateRun) || generateFact(report),
        at: generateRun?.finishedAt ?? generateRun?.startedAt ?? report?.generatedAt ?? null,
        ran: Boolean(generateRun ?? report),
        newestRun: generateRun,
        onOpen: () => openRun(generateRun),
        onRerun: generate.begin,
      },
      {
        key: RUN,
        title: commandLabel(RUN),
        tone: verdict ? VERDICT_TONE[verdict] : NEVER.tone,
        word: verdict ? VERDICT_WORD[verdict] : NEVER.word,
        fact: stepFact(runRun) || runFact(lastRun),
        at: lastRun?.ranAt ?? null,
        ran: lastRun !== null,
        newestRun: runRun,
        onOpen: () =>
          navigate(
            lastRun
              ? `/repos/${repo.id}/runs/${encodeURIComponent(lastRun.runId)}`
              : `/repos/${repo.id}/runs`,
          ),
        onRerun: () => trigger.start(RUN),
      },
    ];

    // A row's key is the command it runs, which is what a waiting job names.
    const withWait = chain.map((row) => {
      const wait = waiting(row.key);
      return {
        ...row,
        ...(wait ?? {}),
        verb: row.ran ? 'Re-run' : 'Run',
        queued: wait !== null,
        running: row.newestRun?.status === 'running',
      };
    });

    // ONE spinner: the work in flight, and only the one waiting its turn when
    // nothing of this repository is running.
    const spinning =
      withWait.find((row) => row.running)?.key ?? withWait.find((row) => row.queued)?.key ?? null;
    return withWait.map((row) => ({ ...row, working: row.key === spinning }));
  }, [
    runs,
    setup,
    report,
    history,
    openRun,
    navigate,
    repo.id,
    repo.fullName,
    activeJobs,
    trigger,
    generate.begin,
  ]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Pipeline" />
      {!loaded ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 aria-label="Loading" className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Pipeline">
          {rows.map((row) => (
            <PipelineRow
              key={row.key}
              title={row.title}
              tone={row.tone}
              word={row.word}
              fact={row.fact}
              at={row.at}
              verb={row.verb}
              busy={busy}
              working={row.working}
              onOpen={row.onOpen}
              onRerun={row.onRerun}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
