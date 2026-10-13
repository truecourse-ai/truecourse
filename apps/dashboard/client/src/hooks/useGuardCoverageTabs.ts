/**
 * The coverage view's main-pane tab set, Guard's heterogeneous doc/conflict tabs.
 * A binding over the shared {@link useGuardTabs} reducer (one tab model, not a
 * second implementation) that keeps the coverage params working: a doc tab
 * mirrors `?doc`, a conflict tab `?conflict`. Only one is active at a time, so a
 * link carrying both lands on the conflict (its resolution surface) with the doc
 * opened alongside as a pinned tab.
 */

import { isConflictId } from '@truecourse/shared';
import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from '@/hooks/useGuardTabs';

const COVERAGE_TABS: GuardTabsParam = {
  read: (p) => p.get('conflict') ?? p.get('doc'),
  write: (next, id) => {
    next.delete('doc');
    next.delete('conflict');
    if (id == null) return;
    if (isConflictId(id)) next.set('conflict', id);
    else next.set('doc', id);
  },
  deepLinkTabs: (p) => [p.get('doc'), p.get('conflict')].filter((v): v is string => v != null),
};

export type GuardCoverageTabsState = GuardTabsState;

export function useGuardCoverageTabs(repoId: string | undefined): GuardCoverageTabsState {
  return useGuardTabs(COVERAGE_TABS, repoId);
}
