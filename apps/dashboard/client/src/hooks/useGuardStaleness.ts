/**
 * The Guard tab's two amber-dot signals (generate / run staleness) plus the
 * pipeline-stage flags the coverage view uses to pick its onboarding empty
 * state. RepoPage calls `refetch()` on tab entry and after guard socket events
 * so the indicators stay in sync without polling. The probe is advisory — a
 * failure is swallowed, never blocking the page.
 */

import { useCallback, useEffect, useState } from 'react';
import type { GuardStaleness } from '@truecourse/shared';
import * as api from '@/lib/api';

const EMPTY: GuardStaleness = {
  generateStale: false,
  runStale: false,
  hasCorpus: false,
  hasScenarios: false,
  hasGenerated: false,
  hasRun: false,
};

export function useGuardStaleness(repoId: string | undefined, ref?: string) {
  const [staleness, setStaleness] = useState<GuardStaleness>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    if (!repoId) return;
    try {
      setStaleness(await api.getGuardStaleness(repoId, ref));
    } catch {
      // Advisory only — leave the last-known flags in place.
    } finally {
      setLoaded(true);
    }
  }, [repoId, ref]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { staleness, loaded, refetch };
}
