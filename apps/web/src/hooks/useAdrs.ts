import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import type { AdrDraftResponse, AdrListItem } from '@/lib/api';

export function useAdrs(
  repoId: string,
  options: { enabled?: boolean; refreshKey?: number } = {},
) {
  const { enabled = true, refreshKey = 0 } = options;
  const [adrs, setAdrs] = useState<AdrListItem[]>([]);
  const [drafts, setDrafts] = useState<AdrDraftResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!repoId || !enabled) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [adrsResult, draftsResult] = await Promise.all([
        api.getAdrs(repoId),
        api.getAdrDrafts(repoId),
      ]);
      setAdrs(adrsResult.adrs);
      setDrafts(draftsResult.drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch ADRs');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, enabled]);

  // Refetch on mount, on dep changes, and whenever the parent bumps
  // `refreshKey` (used after accept/reject from the main-area viewer panel
  // so the sidebar list picks up the server-side change immediately).
  useEffect(() => {
    refetch();
  }, [refetch, refreshKey]);

  return { adrs, drafts, isLoading, error, refetch };
}
