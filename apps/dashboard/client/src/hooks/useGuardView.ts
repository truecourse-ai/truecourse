/**
 * Guard's bidirectional-navigation primitive. `openSpecSection` jumps from a
 * drift, a scenario, or a birth finding to the highlighted spec section on the
 * Guard coverage tab: it lands the Guard section + coverage tab and writes
 * `?guard=`+`?gsec=` in ONE param update so the writes never race (and drops the
 * `?gdrift` tab selection the Runs view was showing).
 *
 * Which *drift tab* is open is owned by `useGuardTabs('gdrift', …)` (the shared
 * preview/pin tab model), not here — this hook only owns the jump OUT of the view.
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface GuardViewState {
  openSpecSection: (doc: string, section: string) => void;
}

export function useGuardView(): GuardViewState {
  const [, setParams] = useSearchParams();

  const openSpecSection = useCallback(
    (doc: string, section: string) => {
      setParams((prev) => {
        const q = new URLSearchParams(prev);
        // Land on the Guard section's coverage tab (where the doc surface lives).
        q.set('section', 'guard');
        q.set('tab', 'coverage');
        q.delete('gdrift');
        q.set('guard', doc);
        q.set('gsec', section);
        return q;
      });
    },
    [setParams],
  );

  return { openSpecSection };
}
