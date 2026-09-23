/**
 * Drives the dashboard `guard generate` trigger. The route ENQUEUES: a 202
 * means the job is on the queue, not that scenarios exist. Progress streams
 * over `spec:progress` and the run completes with `spec:complete`
 * (`kind: guard-generate`) — this hook only owns the trigger, the in-flight
 * flag of the request itself, and the toast that names each refusal's remedy;
 * the completion refetch is wired at page level.
 */

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CREDITS_EXHAUSTED,
  CREDITS_PRICES_UNAVAILABLE,
  CREDITS_PRICES_UNAVAILABLE_MESSAGE,
  CREDITS_PROVIDER_UNAVAILABLE,
} from '@truecourse/shared';
import * as api from '@/lib/api';
import { toastNoLlmProvider, toastOutOfCredits } from '@/dashboard/shell/use-run-trigger';

/** The server's human sentence for a coded refusal, when its body carried one. */
function refusalMessage(e: api.ApiError, fallback: string): string {
  const message = (e.body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

export interface GuardGenerateState {
  /** The start request is in flight — disables the button. */
  busy: boolean;
  /** Enqueue the generate. */
  begin: () => void;
}

export function useGuardGenerate(repoId: string | undefined): GuardGenerateState {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const begin = useCallback(async () => {
    if (!repoId || busy) return;
    setBusy(true);
    try {
      await api.triggerGuardGenerate(repoId);
      toast.success('Scenario generation started', {
        description: 'Follow progress and results in Activity.',
      });
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 409) {
        // An unconfigured workspace, an empty balance and a busy repository all
        // answer 409; only the body's code tells them apart.
        if (e.message === 'llm-not-configured' || e.message === CREDITS_PROVIDER_UNAVAILABLE) {
          toastNoLlmProvider(navigate, refusalMessage(e, 'Add a provider under Settings › Models.'));
        } else if (e.message === CREDITS_EXHAUSTED) {
          toastOutOfCredits(navigate, refusalMessage(e, 'This workspace has no credits left.'));
        } else {
          toast.error('A guard job is already running for this repo.');
        }
      } else if (e instanceof api.ApiError && e.message === CREDITS_PRICES_UNAVAILABLE) {
        toast.error('Prices are not available yet', { description: CREDITS_PRICES_UNAVAILABLE_MESSAGE });
      } else if (e instanceof api.ApiError && e.status === 502) {
        toast.error('Provider check failed', { description: 'The workspace provider did not answer its pre-flight probe.' });
      } else if (e instanceof api.ApiError && e.status === 422) {
        // The open-conflict gate: the full report is the remedy.
        toast.error('Generate blocked by open spec conflicts', { description: e.message });
      } else {
        toast.error('Generate failed', { description: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setBusy(false);
    }
  }, [repoId, busy, navigate]);

  return { busy, begin: () => void begin() };
}
