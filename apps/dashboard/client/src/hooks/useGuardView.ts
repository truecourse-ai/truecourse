/**
 * Guard's bidirectional-navigation primitive. `openSpecSection` jumps from a
 * drift, a scenario, a milestone, or a birth finding to the highlighted spec
 * section on the Guard coverage tab: it lands the Guard section + coverage tab and
 * writes `?guard=`+`?gsec=` in ONE param update so the writes never race (and drops
 * the `?gdrift` tab selection the Runs view was showing). `openGuardFlow` /
 * `openGuardInterface` are the same jump in the other direction
 * — a section's flow row into the Flows tab, a flow's interface into the Interfaces
 * tab — and
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
   * Coverage section's flow row and an interface's "grounds" link both take.
   */
  openGuardFlow: (flowId: string) => void;
  /** Jump to the Interfaces tab with one interface's detail open (`?ginterface=`). */
  openGuardInterface: (interfaceId: string) => void;
  /**
   * Jump to the Dependencies tab — the CTA of a `needs-setup` section, flow or
   * chip. The CTA names ONE service, and that service is the card the
   * user is looking for, so it rides along as `?gext=` and the page opens that
   * card's account form. Called with no service (a CTA that names none, or the
   * synthetic `missing-data` key, which has no card) it just lands the tab.
   */
  openGuardExternals: (service?: string) => void;
}

/** Drop every guard tab selection — each jump owns the pane it lands on. */
function clearGuardSelections(q: URLSearchParams): void {
  for (const key of ['gdrift', 'gflow', 'gfind', 'ginterface', 'gjourney', 'gclaim', 'gext', 'gsrc']) {
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

  const openGuardInterface = useCallback(
    (interfaceId: string) => {
      setParams((prev) => {
        const q = new URLSearchParams(prev);
        q.set('section', 'guard');
        q.set('tab', 'interfaces');
        clearGuardSelections(q);
        q.set('ginterface', interfaceId);
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
        // The dependencies pane's own selection param — a row is a link, so the
        // CTA lands on that dependency's detail and the address stays true.
        if (service) q.set('gext', service);
        return q;
      });
    },
    [setParams],
  );

  return {
    openSpecSection,
    openSpecCoverage,
    openSpecDoc,
    openSpecSources,
    openGuardFlow,
    openGuardInterface,
    openGuardExternals,
  };
}
