/**
 * The Coverage tab's main-pane tab set — Guard's heterogeneous doc/conflict/source
 * tabs. A binding over the shared {@link useGuardTabs} reducer (one tab model, not
 * a second implementation) that keeps Coverage's existing params working: a doc tab
 * mirrors `?guard`, a conflict tab `?gconf`, a registered web source `?gsrc` (the
 * add-a-source view rides the same param as `*new`). Only one is active at a time,
 * so a link carrying several lands on the conflict (its resolution surface) with
 * the others opened alongside as pinned tabs. `?gsec` — a within-doc section
 * detail, not a tab — rides alongside: dropped when the active tab changes,
 * preserved when the already-active tab is reselected.
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { sourceKeyFromParam, sourceKeyParam } from '@/lib/spec-web-source';
import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from './useGuardTabs';

/** Conflict tab ids are overlap keys (`overlap::…`); doc tab ids are plain refs. */
const isOverlap = (id: string): boolean => id.startsWith('overlap::');

const COVERAGE_TABS: GuardTabsParam = {
  read: (p) => p.get('gconf') ?? sourceKeyFromParam(p.get('gsrc')) ?? p.get('guard'),
  write: (next, id) => {
    const current = next.get('gconf') ?? sourceKeyFromParam(next.get('gsrc')) ?? next.get('guard');
    next.delete('guard');
    next.delete('gconf');
    next.delete('gsrc');
    if (id == null) {
      next.delete('gsec');
      return;
    }
    const source = sourceKeyParam(id);
    if (isOverlap(id)) next.set('gconf', id);
    else if (source !== null) next.set('gsrc', source);
    else next.set('guard', id);
    // A different tab takes over — its within-doc section detail doesn't carry.
    if (id !== current) next.delete('gsec');
  },
  deepLinkTabs: (p) =>
    [p.get('guard'), p.get('gconf'), sourceKeyFromParam(p.get('gsrc'))].filter(
      (v): v is string => v != null,
    ),
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
