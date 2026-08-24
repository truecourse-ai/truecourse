/**
 * The Interfaces tab's main-pane tab set — the shared {@link useGuardTabs} reducer
 * bound to `?gplace=<surface>:<id>` (single-click previews, double-click pins),
 * so the catalog list and the detail share ONE addressable model.
 *
 * The subject is a ROW of the catalog, not always an interface (2026-08-24): a
 * web SCREEN, an api OPERATION, a cli COMMAND. All three wear the same address,
 * and the surface is half of it — a place id is scoped to its AREA (web's
 * `violations-list` and a cli command group could collide). A screens surface
 * addresses a PLACE (`web:repo-report`); the two surfaces whose row IS an
 * interface address its own SLUG (`cli:rules-disable`,
 * `api:patch-api-repos-id-rules-rulekey`), so ONE param and one parse cover every
 * shape.
 *
 * WHICH ACTION is open inside a screen is {@link useGuardInterfaceMember}, and it
 * is deliberately NOT a second tab param: expanding a task is a reading posture
 * inside one subject. What `?ginterface=` still does is address one INBOUND: a
 * jump from another surface, a bookmark, the retired `?gjourney` alias. The pane
 * resolves it to the row that owns the member — the SCREEN a task's panel is part
 * of, the operation or the command itself — and picking anything CONSUMES it, so
 * the URL never keeps a member selection the pane is not showing.
 *
 * The detail once carried a SECOND nav bound to `?gcmd=<argv>`: a cli contract
 * used to hold a whole command tree, and the reader picked which command to read.
 * One entry is one invocable thing (2026-08-10) and the contract union made that
 * structural (2026-08-14), so there is exactly one command to read.
 */

import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from './useGuardTabs';

const PLACE_PARAM: GuardTabsParam = {
  read: (params) => params.get('gplace'),
  write: (next, id) => {
    next.delete('ginterface');
    next.delete('gjourney');
    if (id) next.set('gplace', id);
    else next.delete('gplace');
  },
};

export function useGuardInterfaceTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs(PLACE_PARAM, repoId);
}

/**
 * The member expanded inside the open place, by interface id.
 *
 * Local state fed by ONE inbound address. A new `?ginterface=` (or the retired
 * `?gjourney=`) names the member to open and takes over; every other change is a
 * click, and a click writes no param — two params written in two updates would
 * race, and the second write would drop the first.
 */
export function useGuardInterfaceMember(): [string | null, (interfaceId: string | null) => void] {
  const [params] = useSearchParams();
  const inbound = params.get('ginterface') ?? params.get('gjourney');
  const [member, setMember] = useState<string | null>(inbound);
  const seen = useRef(inbound);
  if (seen.current !== inbound) {
    seen.current = inbound;
    // Only an ARRIVING address commands an expansion. The param going away is
    // the selection consuming it, which must not close what it just opened.
    if (inbound) setMember(inbound);
  }
  return [member, setMember];
}
