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
  /**
   * Jump to the Coverage tab with a specific conflict's resolution detail open —
   * the route the Scenarios-tab blocked panel takes for each open conflict. Writes
   * `?gconf=<overlapKey>` and drops the doc/section tab so the conflict wins the
   * coverage read.
   */
  openSpecConflict: (overlapKey: string) => void;
  /**
   * Jump to the Coverage tab with no specific selection — the route the Runs-tab
   * blocked note takes ("resolve the conflicts on Coverage"). Lands the tab; the
   * user picks a conflict from its sidebar.
   */
  openSpecCoverage: () => void;
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
        // Land on the doc's coverage tab — drop any active conflict tab so it
        // doesn't win the coverage read and shadow the jumped-to section.
        q.delete('gconf');
        q.set('guard', doc);
        q.set('gsec', section);
        return q;
      });
    },
    [setParams],
  );

  const openSpecConflict = useCallback(
    (overlapKey: string) => {
      setParams((prev) => {
        const q = new URLSearchParams(prev);
        q.set('section', 'guard');
        q.set('tab', 'coverage');
        q.delete('gdrift');
        // The conflict owns the coverage read — drop any active doc tab + section.
        q.delete('guard');
        q.delete('gsec');
        q.set('gconf', overlapKey);
        return q;
      });
    },
    [setParams],
  );

  const openSpecCoverage = useCallback(() => {
    setParams((prev) => {
      const q = new URLSearchParams(prev);
      q.set('section', 'guard');
      q.set('tab', 'coverage');
      q.delete('gdrift');
      return q;
    });
  }, [setParams]);

  return { openSpecSection, openSpecConflict, openSpecCoverage };
}
