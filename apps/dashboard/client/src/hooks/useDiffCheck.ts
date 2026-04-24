
import { useState, useCallback } from 'react';
import * as api from '@/lib/api';
import type { DiffCheckResponse } from '@/lib/api';

type OnEvent = (event: string, handler: (data: unknown) => void) => () => void;

export function useDiffCheck(repoId: string, onEvent?: OnEvent) {
  const [diffResult, setDiffResult] = useState<DiffCheckResponse | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** POST — starts an async diff on the server. Returns when the server has
   *  emitted `analysis:complete` (or `analysis:canceled`). Progress and the
   *  LLM-estimate prompt fire over the same socket events full analyze uses,
   *  so the dashboard's existing panel and dialog light up automatically. */
  const run = useCallback(async () => {
    if (!onEvent) {
      setError('Socket event stream not available; cannot run diff check.');
      return;
    }
    setIsChecking(true);
    setError(null);
    setDiffResult(null);

    const cleanups: Array<() => void> = [];
    const outcome = new Promise<'completed' | 'canceled'>((resolve, reject) => {
      cleanups.push(onEvent('analysis:complete', (data: unknown) => {
        const d = data as { repoId?: string };
        if (d.repoId !== repoId) return;
        resolve('completed');
      }));
      cleanups.push(onEvent('analysis:canceled', (data: unknown) => {
        const d = data as { repoId?: string };
        if (d.repoId !== repoId) return;
        resolve('canceled');
      }));
      cleanups.push(onEvent('analysis:progress', (data: unknown) => {
        const d = data as { repoId?: string; step?: string; detail?: string };
        if (d.repoId !== repoId) return;
        if (d.step === 'error') {
          reject(new Error(d.detail ?? 'Diff check failed'));
        }
      }));
    });

    try {
      await api.runDiffCheck(repoId);
      const result = await outcome;
      if (result === 'canceled') {
        setError('Diff check cancelled');
        setDiffResult(null);
      } else {
        const data = await api.getDiffCheck(repoId);
        setDiffResult(data);
      }
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 400) {
        setError('Switch to Normal mode and run an analysis first');
      } else {
        setError(err instanceof Error ? err.message : 'Diff check failed');
      }
      setDiffResult(null);
    } finally {
      cleanups.forEach((c) => c());
      setIsChecking(false);
    }
  }, [repoId, onEvent]);

  /** GET — load the persisted diff.json without re-running. */
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
