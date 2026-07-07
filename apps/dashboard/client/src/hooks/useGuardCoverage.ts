/**
 * Per-doc guard coverage join — the section list + statuses the coverage surface
 * paints over the doc. Keyed on the selected doc and gated on `enabled` so it
 * only fetches while the Guard tab is open with a doc chosen. Returns `null`
 * coverage when no doc is selected or the doc/store is gone (404).
 */

import { useCallback, useEffect, useState } from 'react';
import type { GuardDocCoverage } from '@truecourse/shared';
import * as api from '@/lib/api';

export function useGuardCoverage(repoId: string | undefined, doc: string | null, enabled = true, reloadKey = 0) {
  const [coverage, setCoverage] = useState<GuardDocCoverage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!repoId || !doc || !enabled) {
      setCoverage(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setCoverage(await api.getGuardCoverage(repoId, doc));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load guard coverage');
      setCoverage(null);
    } finally {
      setIsLoading(false);
    }
    // reloadKey is a refetch signal (a guard-generate/run completion): re-run the
    // effect below even though the fetch inputs (repo/doc) are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, doc, enabled, reloadKey]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { coverage, isLoading, error, refetch };
}
