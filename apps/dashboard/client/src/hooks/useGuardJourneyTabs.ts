/**
 * The Journeys tab's main-pane tab set — the shared {@link useGuardTabs} reducer
 * bound to `?gjourney=<journeyId>` (single-click previews, double-click pins), so
 * the catalog list and the sequence-diagram detail share ONE addressable model.
 *
 * The journey DETAIL has a second nav of the same shape: a command tree carries
 * one contract per command, and the reader picks which one to read. It binds
 * `?gcmd=<argv>` through the same reducer rather than a second implementation, so
 * a command selection is addressable exactly like a journey selection.
 */

import { useGuardTabs, type GuardTabsState } from './useGuardTabs';

export function useGuardJourneyTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs('gjourney', repoId);
}

export function useGuardCommandTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs('gcmd', repoId);
}
