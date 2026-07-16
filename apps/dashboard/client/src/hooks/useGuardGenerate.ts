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
import type { GuardGenerateMode } from '@/lib/api';

export interface GuardGenerateState {
  /** The estimate the modal renders; null while the modal is closed. */
  estimate: LlmEstimateData | null;
  /** Whether the estimate modal is open. */
  modalOpen: boolean;
  /** A generate is in flight (fetching the estimate OR running) — disables the button. */
  busy: boolean;
  /** The chosen fast-vs-economical authoring dial (item 5); the modal pre-selects it. */
  mode: GuardGenerateMode;
  /** False when `TRUECOURSE_GENERATE_BATCH` forces a fixed batch — the modal hides the choice. */
  canChooseMode: boolean;
  /** Re-estimate for a newly-picked mode (modal toggle). */
  setMode: (mode: GuardGenerateMode) => void;
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
  const [mode, setModeState] = useState<GuardGenerateMode>('economical');
  const [canChooseMode, setCanChooseMode] = useState(true);

  const trigger = useCallback(
    async (confirmed: boolean, chosenMode: GuardGenerateMode) => {
      if (!repoId) return;
      setGenerating(true);
      try {
        const res = await api.triggerGuardGenerate(repoId, confirmed, chosenMode);
        if (res.cancelled) return;
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
      // First fetch uses the remembered per-repo mode (server default) and echoes it.
      const { estimate: est, mode: effMode, canChooseMode: canChoose } = await api.getGuardEstimate(repoId);
      // No stages ⇒ nothing changed ⇒ skip the modal and run (CLI semantics).
      if (!est.stages || est.stages.length === 0) {
        void trigger(true, effMode);
        return;
      }
      setEstimate(est);
      setModeState(effMode);
      setCanChooseMode(canChoose);
      setModalOpen(true);
    } catch (e) {
      toast.error('Could not estimate the generate', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setEstimating(false);
    }
  }, [repoId, estimating, generating, trigger]);

  // Re-estimate for a newly-picked mode — the modal shows the mode-scoped numbers.
  const setMode = useCallback(
    async (next: GuardGenerateMode) => {
      if (!repoId || next === mode) return;
      setModeState(next);
      setEstimating(true);
      try {
        const { estimate: est } = await api.getGuardEstimate(repoId, next);
        setEstimate(est);
      } catch (e) {
        toast.error('Could not estimate the generate', {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setEstimating(false);
      }
    },
    [repoId, mode],
  );

  const confirm = useCallback(() => {
    setModalOpen(false);
    setEstimate(null);
    void trigger(true, mode);
  }, [trigger, mode]);

  const cancel = useCallback(() => {
    setModalOpen(false);
    setEstimate(null);
  }, []);

  return {
    estimate,
    modalOpen,
    busy: estimating || generating,
    mode,
    canChooseMode,
    setMode,
    begin,
    confirm,
    cancel,
  };
}
