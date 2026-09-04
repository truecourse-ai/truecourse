/**
 * Drives the dashboard `guard run` trigger. Deterministic and LLM-free, so there
 * is no estimate — clicking Run enqueues straight away: a 202 means the run is
 * on the queue, not that it ran. The run streams over `spec:progress` (build →
 * run, per-scenario counter) and completes with `spec:complete`
 * (`kind: guard-run`); this hook owns the trigger, the in-flight flag of the
 * request itself, and the toast that names a refusal; the completion refetch is
 * wired at page level.
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
      await api.triggerGuardRun(repoId);
      toast.success('Scenario run started', {
        description: 'Follow it in Activity; the results appear here when it lands.',
      });
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
