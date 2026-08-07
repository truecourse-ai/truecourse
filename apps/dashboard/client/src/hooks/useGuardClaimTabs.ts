/**
 * The Claims tab's main-pane tab set — the shared {@link useGuardTabs} reducer
 * bound to `?gclaim=<claimId>` (single-click previews, double-click pins), so the
 * grouped claim list and the claim detail share ONE addressable model. A refused
 * statement is selectable through the same set under its synthetic
 * `untestable:<doc>#<anchor>#<i>` id — one nav, whatever the row is.
 */

import { useGuardTabs, type GuardTabsState } from './useGuardTabs';

export function useGuardClaimTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs('gclaim', repoId);
}
