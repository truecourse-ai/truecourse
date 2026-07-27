/**
 * The Journeys tab's main-pane tab set — the shared {@link useGuardTabs} reducer
 * bound to `?gjourney=<journeyId>` (single-click previews, double-click pins), so
 * the catalog list and the sequence-diagram detail share ONE addressable model.
 */

import { useGuardTabs, type GuardTabsState } from './useGuardTabs';

export function useGuardJourneyTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs('gjourney', repoId);
}
