/**
 * The Tests tab's main-pane tab set — one {@link useGuardTabs} reducer bound to
 * `?gtest=<testId>`, the address of the ONE standalone test destination. A flow's
 * test row and a run's instance both link here.
 *
 * `?gscn=` is the legacy address of the same thing (a test was reached through
 * its flow before the Tests tab existed), so it READS as `?gtest=` and rewrites
 * to it on the next selection — old links keep working and never leave two params
 * claiming one selection.
 */

import { useGuardTabs, type GuardTabsParam, type GuardTabsState } from './useGuardTabs';

const testTabsParam: GuardTabsParam = {
  read: (params) => params.get('gtest') ?? params.get('gscn'),
  write: (next, id) => {
    next.delete('gscn');
    if (id) next.set('gtest', id);
    else next.delete('gtest');
  },
};

export function useGuardTestTabs(repoId: string | undefined): GuardTabsState {
  return useGuardTabs(testTabsParam, repoId);
}
