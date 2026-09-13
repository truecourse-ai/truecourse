/**
 * Starting a run, and saying so when it cannot start.
 *
 * Every refusal the start route can give has a remedy, and the toast is where
 * the remedy is named: no provider sends the user to Models, a failed provider
 * probe quotes the provider, and a repository already working simply says so.
 * Nothing here throws — a surface that offers the button never has to handle
 * the answer.
 *
 * The route only ENQUEUES, so `pending` covers the request and nothing more:
 * the run appears in Activity within seconds of the click and the live stream
 * takes over from there.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { RunStarter } from '@/components/sessions/run-model';
import { triggerFor } from '@/preview/data/run-triggers';
import { PREVIEW_BASE } from './base';

/**
 * The one no-provider error toast, shared by every surface that hits the wall:
 * a refused start and a connect whose onboarding cannot begin say it the same
 * way, with the remedy attached.
 */
export function toastNoLlmProvider(navigate: (to: string) => void, description: string): void {
  toast.error('No LLM provider configured', {
    description,
    action: {
      label: 'Open Models',
      onClick: () => navigate(`${PREVIEW_BASE}/settings/models`),
    },
  });
}

export function useRunTrigger(repoId: string): RunStarter {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  // One start at a time per surface: the button disables on `pending`, and this
  // closes the double-click window before that state has rendered.
  const inFlight = useRef(false);

  const start = useCallback(
    (command: string, resumeRunId?: string) => {
      const trigger = triggerFor(command);
      if (!trigger || inFlight.current) return;
      inFlight.current = true;
      setPending(true);
      void trigger(repoId, resumeRunId)
        .then((outcome) => {
          switch (outcome.kind) {
            case 'started':
              return;
            case 'not-configured':
              toastNoLlmProvider(navigate, outcome.message);
              return;
            case 'probe-failed':
              toast.error(`Provider check failed: ${outcome.message}`);
              return;
            case 'busy':
              toast.error('A run is already in progress');
              return;
            default:
              toast.error('Could not start the run', { description: outcome.message });
          }
        })
        .finally(() => {
          inFlight.current = false;
          setPending(false);
        });
    },
    [navigate, repoId],
  );

  return useMemo(
    () => ({
      supports: (command: string) => triggerFor(command) !== null,
      start,
      pending,
    }),
    [start, pending],
  );
}
