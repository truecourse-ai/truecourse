/**
 * Drives the dashboard `guard run` trigger. Deterministic and LLM-free, so there
 * is no estimate — clicking Run POSTs straight through. The run streams over
 * `spec:progress` (build → run, per-scenario counter) and completes with
 * `spec:complete` (`kind: guard-run`); this hook owns the trigger + the in-flight
 * flag + the outcome toast, and the completion refetch is wired at page level.
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import * as api from '@/lib/api';

export interface GuardRunState {
  /** A run is in flight — disables the button. */
  running: boolean;
  run: () => void;
}

export function useGuardRun(repoId: string | undefined): GuardRunState {
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    if (!repoId || running) return;
    setRunning(true);
    try {
      const res = await api.triggerGuardRun(repoId);
      if (res.status === 'ok') {
        const s = res.summary;
        const parts = s
          ? `${s.total} scenario${s.total === 1 ? '' : 's'} · ${s.pass} pass` +
            (s.fail ? ` · ${s.fail} fail` : '') +
            (s.stale ? ` · ${s.stale} stale` : '') +
            (s.orphaned ? ` · ${s.orphaned} orphaned` : '')
          : undefined;
        toast.success('Guard run complete', { description: parts });
      } else {
        toast.error('Guard run could not complete', { description: res.message ?? res.status });
      }
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 409) {
        toast.error('A guard job is already running for this repo.');
      } else {
        toast.error('Run failed', { description: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setRunning(false);
    }
  }, [repoId, running]);

  return { running, run };
}
