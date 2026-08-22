// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/hooks/useGuardCoverage.ts; delete with the preview.
/**
 * Per-doc guard coverage join, the section list + statuses the coverage surface
 * paints over the doc. Keyed on the selected doc and gated on `enabled` so it
 * only fetches while the Guard tab is open with a doc chosen. Returns `null`
 * coverage when no doc is selected or the doc/store is gone (404).
 */

import { useCallback, useEffect, useState } from 'react';
import type { GuardDocCoverage } from '@/preview/vendor/shared';
import * as api from '@/preview/vendor/lib/api';

export function useGuardCoverage(
  repoId: string | undefined,
  doc: string | null,
  enabled = true,
  reloadKey = 0,
  ref?: string,
) {
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
      setCoverage(await api.getGuardCoverage(repoId, doc, ref));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load guard coverage');
      setCoverage(null);
    } finally {
      setIsLoading(false);
    }
    // reloadKey is a refetch signal (a guard-generate/run completion): re-run the
    // effect below even though the fetch inputs (repo/doc) are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, doc, enabled, reloadKey, ref]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { coverage, isLoading, error, refetch };
}
