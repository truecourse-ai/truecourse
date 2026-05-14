import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import type { SpecComplianceArtifact } from '@/lib/api';

export function useSpecCompliance(
  repoId: string,
  options: { analysisId?: string; showSatisfied?: boolean; enabled?: boolean } = {},
) {
  const { analysisId, showSatisfied, enabled = true } = options;
  const [artifact, setArtifact] = useState<SpecComplianceArtifact | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!repoId || !enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      setArtifact(await api.getSpecCompliance(repoId, { analysisId, showSatisfied }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch spec compliance');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, analysisId, showSatisfied, enabled]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { artifact, isLoading, error, refetch };
}
