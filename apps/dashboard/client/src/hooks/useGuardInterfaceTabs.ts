/**
 * The Interfaces tab's main-pane tab set — the shared {@link useGuardTabs} reducer
 * bound to `?ginterface=<interfaceId>` (single-click previews, double-click pins), so
 * the catalog list and the sequence-diagram detail share ONE addressable model.
 *
 * The interface DETAIL has a second nav of the same shape: a command tree carries
 * one contract per command, and the reader picks which one to read. It binds
 * `?gcmd=<argv>` through the same reducer rather than a second implementation, so
 * a command selection is addressable exactly like an interface selection.
 */

import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from './useGuardTabs';

/**
 * `?ginterface=<id>`, with `?gjourney=<id>` read as an alias — the param the tab
 * set used before the 2026-08-10 INTERFACE rename. Bookmarks and pasted links
 * survive; a write always emits the current name and drops the alias, so the URL
 * converges on one spelling the moment anything is clicked.
 */
const INTERFACE_PARAM: GuardTabsParam = {
  read: (params) => params.get('ginterface') ?? params.get('gjourney'),
  write: (next, id) => {
    next.delete('gjourney');
    if (id) next.set('ginterface', id);
    else next.delete('ginterface');
  },
};

export function useGuardInterfaceTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs(INTERFACE_PARAM, repoId);
}

export function useGuardCommandTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs('gcmd', repoId);
}
