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
import type { VerifyState, VerifyDiff } from '@/lib/api';

export function useVerifyState(repoId: string | undefined) {
  const [state, setState] = useState<VerifyState | null>(null);
  const [diff, setDiff] = useState<VerifyDiff | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isDiffing, setIsDiffing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [s, d] = await Promise.all([
        api.getVerifyState(repoId),
        api.getVerifyDiff(repoId),
      ]);
      setState(s);
      setDiff(d);
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
      setDiff(null); // a fresh full run moves the baseline — any diff is stale
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Verify failed';
      setError(message);
      toast.error('Verify failed', { description: message });
    } finally {
      setIsRunning(false);
    }
  }, [repoId]);

  const runDiff = useCallback(async () => {
    if (!repoId) return;
    setIsDiffing(true);
    try {
      const d = await api.postVerifyDiff(repoId);
      setDiff(d);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Verify diff failed';
      toast.error('Verify diff failed', { description: message });
    } finally {
      setIsDiffing(false);
    }
  }, [repoId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { state, diff, isLoading, isRunning, isDiffing, error, refetch, run, runDiff };
}
