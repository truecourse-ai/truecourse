/**
 * The Coverage tab's main-pane tab set — Guard's heterogeneous doc/conflict tabs.
 * A binding over the shared {@link useGuardTabs} reducer (one tab model, not a
 * second implementation) that keeps Coverage's existing params working: a doc tab
 * mirrors `?guard`, a conflict tab `?gconf`. Only one is active at a time, so a
 * link carrying both lands on the conflict (its resolution surface) with the doc
 * opened alongside as a pinned tab. `?gsec` — a within-doc section detail, not a
 * tab — rides alongside: dropped when the active tab changes, preserved when the
 * already-active tab is reselected.
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from './useGuardTabs';

/** Conflict tab ids are overlap keys (`overlap::…`); doc tab ids are plain refs. */
const isOverlap = (id: string): boolean => id.startsWith('overlap::');

const COVERAGE_TABS: GuardTabsParam = {
  read: (p) => p.get('gconf') ?? p.get('guard'),
  write: (next, id) => {
    const current = next.get('gconf') ?? next.get('guard');
    next.delete('guard');
    next.delete('gconf');
    if (id == null) {
      next.delete('gsec');
      return;
    }
    if (isOverlap(id)) next.set('gconf', id);
    else next.set('guard', id);
    // A different tab takes over — its within-doc section detail doesn't carry.
    if (id !== current) next.delete('gsec');
  },
  deepLinkTabs: (p) => [p.get('guard'), p.get('gconf')].filter((v): v is string => v != null),
};

export interface GuardCoverageTabsState extends GuardTabsState {
  /** The open within-doc section detail (`?gsec`) — a detail, not a tab. */
  section: string | null;
  selectSection: (anchor: string | null) => void;
}

export function useGuardCoverageTabs(repoId: string | undefined): GuardCoverageTabsState {
  const tabs = useGuardTabs(COVERAGE_TABS, repoId);
  const [params, setParams] = useSearchParams();
  const selectSection = useCallback(
    (anchor: string | null) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (anchor) next.set('gsec', anchor);
        else next.delete('gsec');
        return next;
      }),
    [setParams],
  );
  return { ...tabs, section: params.get('gsec'), selectSection };
}
