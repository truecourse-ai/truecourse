/**
 * Every run of a repository, for the Runs table: the baseline runs and the
 * pull-request head runs the gate stored, each naming its pull request and
 * where it ran. One read (`guard/history?all=1`); `reloadKey` re-reads it when
 * a run lands on the socket. A fixture repository's fake history answers the
 * same call.
 */

import { useEffect, useState } from 'react';
import type { GuardHistoryEntry } from '@/preview/vendor/shared';
import * as api from '@/preview/vendor/lib/api';

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
      .getGuardHistory(repoId, undefined, { all: true })
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
