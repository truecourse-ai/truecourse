// PREVIEW: REAL — the shell's one way to start an agentic run on a connected
// repository.

/**
 * Starting a run, and saying so when it cannot start.
 *
 * Every refusal the start route can give has a remedy, and the toast is where
 * the remedy is named: no provider sends the user to Models, a failed provider
 * probe quotes the provider, and a repository already scanning simply says so.
 * Nothing here throws — a surface that offers the button never has to handle
 * the answer.
 *
 * A start request stays open for the whole run, so `pending` is not a progress
 * indicator: the run appears in Activity within seconds of the click and the
 * live stream takes over from there.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { RunStarter } from '@/components/sessions/run-model';
import { FIRST_RUN_COMMAND, triggerFor } from '@/preview/data/run-triggers';
import { PREVIEW_BASE } from './base';

/** A repository with nothing on it starts with the scan: everything else needs a corpus. */
const FIRST_OFFER = { command: FIRST_RUN_COMMAND, label: 'Start scan' } as const;

export function useRunTrigger(repoId: string): RunStarter {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  // One start at a time per surface: the button disables on `pending`, and this
  // closes the double-click window before that state has rendered.
  const inFlight = useRef(false);

  const start = useCallback(
    (command: string) => {
      const trigger = triggerFor(command);
      if (!trigger || inFlight.current) return;
      inFlight.current = true;
      setPending(true);
      void trigger(repoId)
        .then((outcome) => {
          switch (outcome.kind) {
            case 'started':
              return;
            case 'not-configured':
              toast.error('No LLM provider configured', {
                description: outcome.message,
                action: {
                  label: 'Open Models',
                  onClick: () => navigate(`${PREVIEW_BASE}/settings/models`),
                },
              });
              return;
            case 'probe-failed':
              toast.error(`Provider check failed: ${outcome.message}`);
              return;
            case 'busy':
              toast.error('A scan is already running');
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
      first: FIRST_OFFER,
    }),
    [start, pending],
  );
}
