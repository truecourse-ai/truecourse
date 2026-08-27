/**
 * The Activity surface on the real sessions
 * store, in two levels:
 *
 *   1. the runs index — every agentic run of the repository as one flat table
 *      ({@link RunsIndex});
 *   2. one run as a conversation — its phase checklist and its sessions merged
 *      into a single stream, with the transcripts expanding in place
 *      ({@link RunConversation}).
 *
 * Selection lives in the URL, unchanged: `?run=<runId>` opens level two (the
 * CLI's "Watch live" deep link mints exactly that), `?ses=<sessionId>` opens
 * one session's thread inside it. No `run` param is the index. The runId is
 * unique across commands, so the command never rides the URL.
 *
 * Live: `useSessionRuns` re-reads the index on every store write, and
 * `useRunStream` tails the open run — its pushed run record advances the phase
 * cards, its pushed events feed the open threads.
 */

import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessionRuns } from '@/hooks/useSessionRuns';
import { useRunStream } from '@/hooks/useRunStream';
import { RunConversation } from './RunConversation';
import { RunsIndex } from './RunsIndex';

export function SessionsActivityView({ repoId }: { repoId: string }) {
  const { runs, error, refetch } = useSessionRuns(repoId, true);
  const [params, setParams] = useSearchParams();

  const runParam = params.get('run');
  const sesParam = params.get('ses');

  const openRun = useCallback(
    (runId: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (runId === null) next.delete('run');
          else next.set('run', runId);
          next.delete('ses');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const openSession = useCallback(
    (sessionId: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (sessionId === null) next.delete('ses');
          else next.set('ses', sessionId);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const listedRun = runParam === null ? null : (runs?.find((r) => r.runId === runParam) ?? null);
  // A `?run=` that matches nothing: the index says so rather than silently
  // opening some other run.
  const notFound = runParam !== null && runs !== null && listedRun === null;

  // The live tail of the open run, while its process is alive. Joined BEFORE
  // the transcript snapshots resolve; overlap dedups by seq.
  const { liveEvents, liveRun } = useRunStream(
    repoId,
    listedRun?.command ?? null,
    listedRun?.runId ?? null,
    listedRun?.status === 'running',
  );
  // The pushed record is always fresher than the listing's.
  const run = liveRun && liveRun.runId === listedRun?.runId ? liveRun : listedRun;

  // A run that just left `running` (finished, failed, interrupted) re-reads the
  // list so the index agrees with the store.
  useEffect(() => {
    if (liveRun && liveRun.status !== 'running') void refetch();
  }, [liveRun, liveRun?.status, refetch]);

  if (run) {
    return (
      <RunConversation
        key={run.runId}
        repoId={repoId}
        run={run}
        liveEvents={liveEvents}
        openSessionId={sesParam}
        onOpenSession={openSession}
        onBack={() => openRun(null)}
      />
    );
  }

  return <RunsIndex runs={runs} error={error} notFound={notFound} onOpen={openRun} />;
}
