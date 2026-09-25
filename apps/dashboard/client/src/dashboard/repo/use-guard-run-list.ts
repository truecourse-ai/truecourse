/**
 * Every run of a repository, for the Runs table: each naming its origin, its
 * pull request when it has one, and where it ran. One read (`guard/history?all=1`); `reloadKey` re-reads it when
 * a run lands on the socket.
 */

import { useEffect, useState } from 'react';
import { guardSummaryFailed, type GuardHistoryEntry } from '@truecourse/shared';
import * as api from '@/lib/api';

/** A stored run's verdict: one failure or one error makes the run a failure. */
export function guardRunVerdict(entry: GuardHistoryEntry): 'pass' | 'fail' {
  return guardSummaryFailed(entry.summary) ? 'fail' : 'pass';
}

export interface GuardRunListState {
  runs: GuardHistoryEntry[];
  loading: boolean;
  error: string | null;
}

export function useGuardRunList(repoId: string, reloadKey = 0): GuardRunListState {
  const [runs, setRuns] = useState<GuardHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getGuardHistory(repoId, { all: true })
      .then((history) => {
        if (!cancelled) setRuns(history.runs);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load runs');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, reloadKey]);

  return { runs, loading, error };
}
