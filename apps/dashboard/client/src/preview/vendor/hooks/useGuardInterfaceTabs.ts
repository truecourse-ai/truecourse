/**
 * The Interfaces tab's main-pane tab set, the shared {@link useGuardTabs} reducer
 * bound to `?interface=<interfaceId>` (single-click previews, double-click pins), so
 * the catalog list and the sequence-diagram detail share ONE addressable model.
 *
 * The detail once carried a SECOND nav of the same shape, bound to `?command=<argv>`:
 * a cli contract used to hold a whole command tree, and the reader picked which
 * command to read. One entry is one invocable thing (2026-08-10) and the contract
 * union made that structural (2026-08-14), so there is exactly one command to
 * read and the nav is gone.
 */

import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from '@/preview/vendor/hooks/useGuardTabs';

/**
 * `?interface=<id>`, with `?journey=<id>` read as an alias, the param the tab
 * set used before the 2026-08-10 INTERFACE rename. Bookmarks and pasted links
 * survive; a write always emits the current name and drops the alias, so the URL
 * converges on one spelling the moment anything is clicked.
 */
const INTERFACE_PARAM: GuardTabsParam = {
  read: (params) => params.get('interface') ?? params.get('journey'),
  write: (next, id) => {
    next.delete('journey');
    if (id) next.set('interface', id);
    else next.delete('interface');
  },
};

export function useGuardInterfaceTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs(INTERFACE_PARAM, repoId);
}
