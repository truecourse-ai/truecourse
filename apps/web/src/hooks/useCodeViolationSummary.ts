import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/api';
import type { CodeViolationSummary } from '@/lib/api';

export function useCodeViolationSummary(repoId: string, analysisId?: string) {
  const [summary, setSummary] = useState<CodeViolationSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    try {
      const data = await api.getCodeViolationSummary(repoId, analysisId);
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [repoId, analysisId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { summary, isLoading, refetch: fetch };
}
