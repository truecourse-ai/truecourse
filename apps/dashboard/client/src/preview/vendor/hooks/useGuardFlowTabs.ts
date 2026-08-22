// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/hooks/useGuardFlowTabs.ts; delete with the preview.
/**
 * The Flows tab's main-pane tab set, one {@link useGuardTabs} reducer bound to
 * `?flow=<flowId>` (Manual pseudo-flow ids ride as-is).
 *
 * A flow is the ONLY thing that opens here, because a flow and its test are one
 * entity now: there is no test address at all.
 *
 * Tab ids stay self-describing (`flow:…`) so a second kind could join later
 * without re-keying the ones already in the URL.
 */

import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from '@/preview/vendor/hooks/useGuardTabs';

const FLOW = 'flow:';

/** The tab id of a flow (`flow:<flowId>`). */
export function flowTabId(flowId: string): string {
  return `${FLOW}${flowId}`;
}

/** The flow id behind a flow tab id, else null. */
export function tabFlowId(tabId: string | null): string | null {
  return tabId && tabId.startsWith(FLOW) ? tabId.slice(FLOW.length) : null;
}

const flowTabsParam: GuardTabsParam = {
  read: (params) => {
    const flow = params.get('flow');
    return flow ? flowTabId(flow) : null;
  },
  write: (next, id) => {
    const flow = tabFlowId(id);
    if (flow) next.set('flow', flow);
    else next.delete('flow');
  },
};

export function useGuardFlowTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs(flowTabsParam, repoId);
}
