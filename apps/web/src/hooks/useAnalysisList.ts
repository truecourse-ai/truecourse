
import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/api';
import type { AnalysisSummary } from '@/lib/api';

export function useAnalysisList(repoId: string) {
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAnalyses = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    try {
      const data = await api.getAnalyses(repoId);
      setAnalyses(data);
    } catch {
      // Silently fail — empty list is fine
    } finally {
      setIsLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    fetchAnalyses();
  }, [fetchAnalyses]);

  return { analyses, isLoading, refetch: fetchAnalyses };
}
