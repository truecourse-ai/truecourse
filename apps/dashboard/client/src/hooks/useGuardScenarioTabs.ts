/**
 * The Scenarios tab's main-pane tab set — Guard's `?gscn` addressable
 * transient/pinned tabs. A thin binding over the shared {@link useGuardTabs}
 * reducer (one tab model, not a second implementation): the Runs tab binds the
 * same reducer to `?gdrift`. Kept as its own hook so the Scenarios wiring reads
 * by intent, and so the guard-scenarios tests exercise the shared model through
 * this exact entry point.
 */

import { useGuardTabs, type GuardTab, type GuardTabsState } from './useGuardTabs';

export type GuardScenarioTab = GuardTab;
export type GuardScenarioTabsState = GuardTabsState;

export function useGuardScenarioTabs(repoId: string | undefined): GuardScenarioTabsState {
  return useGuardTabs('gscn', repoId);
}
