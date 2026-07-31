/**
 * Guard's bidirectional-navigation primitive. `openSpecSection` jumps from a
 * drift, a scenario, a milestone, or a birth finding to the highlighted spec
 * section on the Guard coverage tab: it lands the Guard section + coverage tab and
 * writes `?guard=`+`?gsec=` in ONE param update so the writes never race (and drops
 * the `?gdrift` tab selection the Runs view was showing). `openGuardFlow` /
 * `openGuardJourney` are the same jump in the other direction — a section's flow
 * row into the Flows tab, a flow's journey into the Journeys tab — and
 * `openSpecDoc` / `openSpecSources` connect the Sources page to the doc viewer
 * and back.
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
  /**
   * Jump to the Coverage tab with ONE doc open (`?guard=`) and no section
   * highlighted — the route a Sources page's fetched page takes into the doc
   * viewer. A doc has one home, and this is it.
   */
  openSpecDoc: (ref: string) => void;
  /**
   * Jump to the Sources tab — the route the pre-scan corpus note takes ("add a
   * documentation site first"). Lands the page; the user picks or adds a site.
   */
  openSpecSources: () => void;
  /**
   * Jump to the Flows tab with one flow's detail open (`?gflow=`) — the route a
   * Coverage section's flow row and a journey's "grounds" link both take.
   */
  openGuardFlow: (flowId: string) => void;
  /** Jump to the Journeys tab with one journey's detail open (`?gjourney=`). */
  openGuardJourney: (journeyId: string) => void;
  /**
   * Jump to the Tests tab with one test's detail open (`?gtest=`) — the route a
   * flow's test row and a run instance's "open this test" link both take. A test
   * has exactly ONE home, and this is it.
   */
  openGuardTest: (testId: string) => void;
  /**
   * Jump to the External APIs tab — the CTA of a `needs-setup` section, flow or
   * chip (item 65). The CTA names ONE service, and that service is the card the
   * user is looking for, so it rides along as `?gext=` and the page opens that
   * card's account form. Called with no service (a CTA that names none, or the
   * synthetic `missing-data` key, which has no card) it just lands the tab.
   */
  openGuardExternals: (service?: string) => void;
}

/** Drop every guard tab selection — each jump owns the pane it lands on. */
function clearGuardSelections(q: URLSearchParams): void {
  for (const key of ['gdrift', 'gflow', 'gscn', 'gtest', 'gfind', 'gjourney', 'gext', 'gsrc']) {
    q.delete(key);
  }
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
        clearGuardSelections(q);
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
        clearGuardSelections(q);
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
      clearGuardSelections(q);
      return q;
    });
  }, [setParams]);

  const openSpecDoc = useCallback(
    (ref: string) => {
      setParams((prev) => {
        const q = new URLSearchParams(prev);
        q.set('section', 'guard');
        q.set('tab', 'coverage');
        clearGuardSelections(q);
        // The doc owns the coverage read — drop any active conflict tab, and land
        // on the doc itself (no section highlighted).
        q.delete('gconf');
        q.delete('gsec');
        q.set('guard', ref);
        return q;
      });
    },
    [setParams],
  );

  const openSpecSources = useCallback(() => {
    setParams((prev) => {
      const q = new URLSearchParams(prev);
      q.set('section', 'guard');
      q.set('tab', 'sources');
      clearGuardSelections(q);
      return q;
    });
  }, [setParams]);

  const openGuardFlow = useCallback(
    (flowId: string) => {
      setParams((prev) => {
        const q = new URLSearchParams(prev);
        q.set('section', 'guard');
        q.set('tab', 'guardflows');
        clearGuardSelections(q);
        q.set('gflow', flowId);
        return q;
      });
    },
    [setParams],
  );

  const openGuardJourney = useCallback(
    (journeyId: string) => {
      setParams((prev) => {
        const q = new URLSearchParams(prev);
        q.set('section', 'guard');
        q.set('tab', 'journeys');
        clearGuardSelections(q);
        q.set('gjourney', journeyId);
        return q;
      });
    },
    [setParams],
  );

  const openGuardTest = useCallback(
    (testId: string) => {
      setParams((prev) => {
        const q = new URLSearchParams(prev);
        q.set('section', 'guard');
        q.set('tab', 'tests');
        clearGuardSelections(q);
        q.set('gtest', testId);
        return q;
      });
    },
    [setParams],
  );

  const openGuardExternals = useCallback(
    (service?: string) => {
      setParams((prev) => {
        const q = new URLSearchParams(prev);
        q.set('section', 'guard');
        q.set('tab', 'externals');
        clearGuardSelections(q);
        // A one-shot selection: the externals pane consumes it (opens that card's
        // form) and drops it, so a later manual visit to the tab is a plain read.
        if (service) q.set('gext', service);
        return q;
      });
    },
    [setParams],
  );

  return {
    openSpecSection,
    openSpecConflict,
    openSpecCoverage,
    openSpecDoc,
    openSpecSources,
    openGuardFlow,
    openGuardJourney,
    openGuardTest,
    openGuardExternals,
  };
}
