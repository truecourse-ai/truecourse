/**
 * Top-level hook for the BL Drift Verify state. Same shape as
 * `useContractsTree` / `useCanonicalSpecTree`: state lives in
 * RepoPage so it survives tab switches; the parent wires the
 * `spec:complete` socket event (kind === 'verify') to `refetch()`.
 *
 * Three actions exposed:
 *   - `state`       — persisted verify-state.json (null until a run)
 *   - `refetch()`   — re-read state from disk
 *   - `run()`       — kick off a fresh verify run, updates state on completion
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as api from '@/lib/api';
import type { VerifyState } from '@/lib/api';

export function useVerifyState(repoId: string | undefined) {
  const [state, setState] = useState<VerifyState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const s = await api.getVerifyState(repoId);
      setState(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load verify state');
    } finally {
      setIsLoading(false);
    }
  }, [repoId]);

  const run = useCallback(async () => {
    if (!repoId) return;
    setIsRunning(true);
    setError(null);
    try {
      const s = await api.postVerifyRun(repoId);
      setState(s);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Verify failed';
      setError(message);
      toast.error('Verify failed', { description: message });
    } finally {
      setIsRunning(false);
    }
  }, [repoId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { state, isLoading, isRunning, error, refetch, run };
}
