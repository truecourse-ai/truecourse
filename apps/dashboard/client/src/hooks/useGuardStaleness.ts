/**
 * The pipeline's run-staleness amber dot plus the pipeline-stage flags the
 * coverage view uses to pick its onboarding empty state. The caller re-reads with
 * `refetch()` on tab entry and after guard socket events so the indicators stay
 * in sync without polling. The probe is advisory — a failure is swallowed,
 * never blocking the page.
 */

import { useCallback, useEffect, useState } from 'react';
import type { GuardStaleness } from '@truecourse/shared';
import * as api from '@/lib/api';

const EMPTY: GuardStaleness = {
  runStale: false,
  hasScenarios: false,
  hasGenerated: false,
  hasRun: false,
};

export function useGuardStaleness(repoId: string | undefined, ref?: string, enabled = true) {
  const [staleness, setStaleness] = useState<GuardStaleness>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    // `enabled` lets a caller hold the probe until it has a repository to ask
    // about.
    if (!repoId || !enabled) return;
    try {
      setStaleness(await api.getGuardStaleness(repoId, ref));
    } catch {
      // Advisory only — leave the last-known flags in place.
    } finally {
      setLoaded(true);
    }
  }, [repoId, ref, enabled]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { staleness, loaded, refetch };
}
