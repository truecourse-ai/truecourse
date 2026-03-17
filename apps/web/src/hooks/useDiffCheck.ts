
import { useState, useCallback } from 'react';
import * as api from '@/lib/api';
import type { DiffCheckResponse } from '@/lib/api';

export function useDiffCheck(repoId: string) {
  const [diffResult, setDiffResult] = useState<DiffCheckResponse | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** POST — run full diff analysis + LLM + save to DB */
  const run = useCallback(async () => {
    setIsChecking(true);
    setError(null);
    try {
      const result = await api.runDiffCheck(repoId);
      setDiffResult(result);
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 409) {
        setError('Switch to Normal mode and run an analysis first');
      } else {
        setError(err instanceof Error ? err.message : 'Diff check failed');
      }
      setDiffResult(null);
    } finally {
      setIsChecking(false);
    }
  }, [repoId]);

  /** GET — load saved diff check from DB (instant) */
  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.getDiffCheck(repoId);
      setDiffResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diff check');
      setDiffResult(null);
    }
  }, [repoId]);

  const clear = useCallback(() => {
    setDiffResult(null);
    setError(null);
  }, []);

  return { diffResult, isChecking, error, run, load, clear };
}
