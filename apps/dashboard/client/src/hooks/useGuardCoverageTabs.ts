/**
 * The Coverage tab's main-pane tab set — Guard's heterogeneous doc/conflict tabs.
 * A binding over the shared {@link useGuardTabs} reducer (one tab model, not a
 * second implementation) that keeps Coverage's existing params working: a doc tab
 * mirrors `?guard`, a conflict tab `?gconf`. Only one is active at a time, so a
 * link carrying both lands on the conflict (its resolution surface) with the doc
 * opened alongside as a pinned tab.
 *
 * Two WITHIN-doc selections ride alongside the tabs rather than being tabs: the
 * section detail (`?gsec`) and, inside it, the claim being read (`?gclaim`).
 * Both are dropped when the active tab changes and preserved when the
 * already-active tab is reselected; picking another section drops the claim,
 * because a claim is only ever read inside the section that states it.
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isConflictId } from '@truecourse/shared';
import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from './useGuardTabs';

const COVERAGE_TABS: GuardTabsParam = {
  read: (p) => p.get('gconf') ?? p.get('guard'),
  write: (next, id) => {
    const current = next.get('gconf') ?? next.get('guard');
    next.delete('guard');
    next.delete('gconf');
    if (id == null) {
      next.delete('gsec');
      next.delete('gclaim');
      return;
    }
    if (isConflictId(id)) next.set('gconf', id);
    else next.set('guard', id);
    // A different tab takes over — its within-doc selections don't carry.
    if (id !== current) {
      next.delete('gsec');
      next.delete('gclaim');
    }
  },
  deepLinkTabs: (p) => [p.get('guard'), p.get('gconf')].filter((v): v is string => v != null),
};

export interface GuardCoverageTabsState extends GuardTabsState {
  /** The open within-doc section detail (`?gsec`) — a detail, not a tab. */
  section: string | null;
  selectSection: (anchor: string | null) => void;
  /** The claim being read inside that section (`?gclaim`). */
  claim: string | null;
  selectClaim: (claimId: string | null) => void;
  /**
   * Land a claim whose doc/section the URL doesn't name yet — a `?gclaim=` deep
   * link, or a jump from another surface. ONE param write, so the doc, the
   * section and the claim can never race each other.
   */
  focusClaim: (claimId: string, doc: string, anchor: string) => void;
}

export function useGuardCoverageTabs(repoId: string | undefined): GuardCoverageTabsState {
  const tabs = useGuardTabs(COVERAGE_TABS, repoId);
  const [params, setParams] = useSearchParams();

  const selectSection = useCallback(
    (anchor: string | null) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        // Another section is another set of claims — the open one doesn't carry.
        next.delete('gclaim');
        if (anchor) next.set('gsec', anchor);
        else next.delete('gsec');
        return next;
      }),
    [setParams],
  );

  const selectClaim = useCallback(
    (claimId: string | null) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (claimId) next.set('gclaim', claimId);
        else next.delete('gclaim');
        return next;
      }),
    [setParams],
  );

  const focusClaim = useCallback(
    (claimId: string, doc: string, anchor: string) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('gconf');
        next.set('guard', doc);
        next.set('gsec', anchor);
        next.set('gclaim', claimId);
        return next;
      }),
    [setParams],
  );

  return {
    ...tabs,
    section: params.get('gsec'),
    selectSection,
    claim: params.get('gclaim'),
    selectClaim,
    focusClaim,
  };
}
