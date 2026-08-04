/**
 * Drives the dashboard `guard generate` trigger with the pre-flight estimate gate.
 * `begin()` fetches the estimate (the SAME estimateGuardTokens the CLI renders): no
 * stages ⇒ nothing changed ⇒ trigger directly (the CLI skips the confirm too);
 * otherwise open the estimate modal, and `confirm()` triggers with the confirmed
 * flag. The generate itself streams over `spec:progress` and completes with
 * `spec:complete` (`kind: guard-generate`) — this hook only owns the trigger + the
 * in-flight flag + the outcome toast; the completion refetch is wired at page level.
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { LlmEstimateData } from './useSocket';
import * as api from '@/lib/api';

export interface GuardGenerateState {
  /** The estimate the modal renders; null while the modal is closed. */
  estimate: LlmEstimateData | null;
  /** Whether the estimate modal is open. */
  modalOpen: boolean;
  /** A generate is in flight (fetching the estimate OR running) — disables the button. */
  busy: boolean;
  /** Fetch the estimate, then open the modal (or trigger directly when nothing changed). */
  begin: () => void;
  /** Confirm the estimate → trigger the generate. */
  confirm: () => void;
  /** Dismiss the estimate modal without running. */
  cancel: () => void;
}

export function useGuardGenerate(repoId: string | undefined): GuardGenerateState {
  const [estimate, setEstimate] = useState<LlmEstimateData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [generating, setGenerating] = useState(false);

  const trigger = useCallback(
    async (confirmed: boolean) => {
      if (!repoId) return;
      setGenerating(true);
      try {
        const res = await api.triggerGuardGenerate(repoId, confirmed);
        if (res.cancelled) return;
        // A run that generated NOTHING — a stage that lost every LLM call, an
        // unusable recipe, no corpus. It is an error, never "wrote 0 scenarios".
        if (res.status && res.status !== 'ok') {
          toast.error('Generate aborted', {
            description: res.reason ?? `The run ended \`${res.status}\` — nothing was generated.`,
          });
          return;
        }
        if (res.noChanges) {
          toast.success('Nothing changed', {
            description: 'Every section is already guarded since the last generate.',
          });
        } else {
          const findings = res.birthFindings
            ? ` · ${res.birthFindings} birth finding${res.birthFindings === 1 ? '' : 's'}`
            : '';
          toast.success(`Wrote ${res.written ?? 0} scenario${res.written === 1 ? '' : 's'}${findings}`, {
            description: 'Review + commit the scenarios, then run guard.',
          });
        }
      } catch (e) {
        if (e instanceof api.ApiError && e.status === 409) {
          toast.error('A guard job is already running for this repo.');
        } else {
          toast.error('Generate failed', { description: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        setGenerating(false);
      }
    },
    [repoId],
  );

  const begin = useCallback(async () => {
    if (!repoId || estimating || generating) return;
    setEstimating(true);
    try {
      const { estimate: est } = await api.getGuardEstimate(repoId);
      // No stages ⇒ nothing changed ⇒ skip the modal and run (CLI semantics).
      if (!est.stages || est.stages.length === 0) {
        void trigger(true);
        return;
      }
      setEstimate(est);
      setModalOpen(true);
    } catch (e) {
      toast.error('Could not estimate the generate', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setEstimating(false);
    }
  }, [repoId, estimating, generating, trigger]);

  const confirm = useCallback(() => {
    setModalOpen(false);
    setEstimate(null);
    void trigger(true);
  }, [trigger]);

  const cancel = useCallback(() => {
    setModalOpen(false);
    setEstimate(null);
  }, []);

  return { estimate, modalOpen, busy: estimating || generating, begin, confirm, cancel };
}
