/**
 * Tracks whether Generate / Verify have unfinished work to do.
 * Parent (RepoPage) calls `refetch()` after every `spec:complete`
 * socket event and every decision change so the indicators stay in
 * sync without polling.
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';

export function useSpecStaleness(repoId: string | undefined) {
  const [contractsStale, setContractsStale] = useState(false);
  const [verifyStale, setVerifyStale] = useState(false);

  const refetch = useCallback(async () => {
    if (!repoId) return;
    try {
      const r = await api.getSpecStaleness(repoId);
      setContractsStale(r.contractsStale);
      setVerifyStale(r.verifyStale);
    } catch {
      // Best-effort: the dots are advisory, not load-bearing. Silently
      // ignore failures so a flaky probe never blocks the page.
    }
  }, [repoId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { contractsStale, verifyStale, refetch };
}
