// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/hooks/useGuardCoverageTabs.ts; delete with the preview.
/**
 * The Coverage tab's main-pane tab set, Guard's heterogeneous doc/conflict tabs.
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
import { isConflictId } from '@/preview/vendor/shared';
import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from '@/preview/vendor/hooks/useGuardTabs';

const COVERAGE_TABS: GuardTabsParam = {
  read: (p) => p.get('conflict') ?? p.get('doc'),
  write: (next, id) => {
    const current = next.get('conflict') ?? next.get('doc');
    next.delete('doc');
    next.delete('conflict');
    if (id == null) {
      next.delete('section');
      next.delete('claim');
      return;
    }
    if (isConflictId(id)) next.set('conflict', id);
    else next.set('doc', id);
    // A different tab takes over, its within-doc selections don't carry.
    if (id !== current) {
      next.delete('section');
      next.delete('claim');
    }
  },
  deepLinkTabs: (p) => [p.get('doc'), p.get('conflict')].filter((v): v is string => v != null),
};

export interface GuardCoverageTabsState extends GuardTabsState {
  /** The open within-doc section detail (`?gsec`), a detail, not a tab. */
  section: string | null;
  selectSection: (anchor: string | null) => void;
  /** The claim being read inside that section (`?gclaim`). */
  claim: string | null;
  selectClaim: (claimId: string | null) => void;
  /**
   * Land a claim whose doc/section the URL doesn't name yet, a `?claim=` deep
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
        // Another section is another set of claims, the open one doesn't carry.
        next.delete('claim');
        if (anchor) next.set('section', anchor);
        else next.delete('section');
        return next;
      }),
    [setParams],
  );

  const selectClaim = useCallback(
    (claimId: string | null) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (claimId) next.set('claim', claimId);
        else next.delete('claim');
        return next;
      }),
    [setParams],
  );

  const focusClaim = useCallback(
    (claimId: string, doc: string, anchor: string) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('conflict');
        next.set('doc', doc);
        next.set('section', anchor);
        next.set('claim', claimId);
        return next;
      }),
    [setParams],
  );

  return {
    ...tabs,
    section: params.get('section'),
    selectSection,
    claim: params.get('claim'),
    selectClaim,
    focusClaim,
  };
}
