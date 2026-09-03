/**
 * One run's snapshot, by id (`guard/runs/:runId`, with the flow join the
 * results paint from). The run page reads exactly the run its address names:
 * `run` is null while nothing has arrived and after a miss, and `loading`
 * tells the two apart, so an unknown id reads as such only once the server
 * has said so.
 */

import { useEffect, useState } from 'react';
import type { GuardLatestWithRunFlows } from '@/preview/vendor/shared';
import * as api from '@/preview/vendor/lib/api';

export interface GuardRunState {
  run: GuardLatestWithRunFlows | null;
  loading: boolean;
  error: string | null;
}

export function useGuardRun(repoId: string, runId: string): GuardRunState {
  const [run, setRun] = useState<GuardLatestWithRunFlows | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRun(null);
    setLoading(true);
    setError(null);
    api
      .getGuardRun(repoId, runId)
      .then((found) => {
        if (!cancelled) setRun(found);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load the run');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, runId]);

  return { run, loading, error };
}
