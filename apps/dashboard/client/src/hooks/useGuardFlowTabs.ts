/**
 * The Flows tab's main-pane tab set — one {@link useGuardTabs} reducer bound to
 * `?gflow=<flowId>` (Manual pseudo-flow ids ride as-is).
 *
 * Only flows open here. A TEST is not a tab on this tab: it has exactly one home
 * (`?gtest=` on the Tests tab), reached from a flow's test row — see
 * `useGuardTestTabs`. Tab ids stay self-describing (`flow:…`) so a second kind
 * could join later without re-keying the ones already in the URL.
 */

import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from './useGuardTabs';

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
    const flow = params.get('gflow');
    return flow ? flowTabId(flow) : null;
  },
  write: (next, id) => {
    const flow = tabFlowId(id);
    if (flow) next.set('gflow', flow);
    else next.delete('gflow');
  },
};

export function useGuardFlowTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs(flowTabsParam, repoId);
}
