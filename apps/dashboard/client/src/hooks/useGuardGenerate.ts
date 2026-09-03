/**
 * Drives the dashboard `guard generate` trigger. The route ENQUEUES: a 202
 * means the job is on the queue, not that scenarios exist. Progress streams
 * over `spec:progress` and the run completes with `spec:complete`
 * (`kind: guard-generate`) — this hook only owns the trigger, the in-flight
 * flag of the request itself, and the toast that names each refusal's remedy;
 * the completion refetch is wired at page level.
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import * as api from '@/lib/api';

export interface GuardGenerateState {
  /** The start request is in flight — disables the button. */
  busy: boolean;
  /** Enqueue the generate. */
  begin: () => void;
}

export function useGuardGenerate(repoId: string | undefined): GuardGenerateState {
  const [busy, setBusy] = useState(false);

  const begin = useCallback(async () => {
    if (!repoId || busy) return;
    setBusy(true);
    try {
      await api.triggerGuardGenerate(repoId);
      toast.success('Scenario generation started', {
        description: 'Follow it in Activity; the scenarios appear here when it lands.',
      });
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 409) {
        // The unconfigured workspace and the busy repository share the status;
        // the body's code tells them apart.
        toast.error(
          e.message === 'llm-not-configured'
            ? 'No LLM provider configured — add one under Settings › Models.'
            : 'A guard job is already running for this repo.',
        );
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
  }, [repoId, busy]);

  return { busy, begin: () => void begin() };
}
