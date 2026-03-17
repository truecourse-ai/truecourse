
import { useState, useEffect, useCallback, useMemo } from 'react';
import * as api from '@/lib/api';
import type { InsightResponse } from '@/lib/api';

export function useInsights(repoId: string, selectedServiceId?: string) {
  const [insights, setInsights] = useState<InsightResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getViolations(repoId);
      setInsights(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch insights');
    } finally {
      setIsLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const filteredInsights = useMemo(() => {
    const severityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
      info: 4,
    };
    const typeOrder: Record<string, number> = {
      service: 0,
      module: 1,
      function: 2,
      database: 3,
    };
    const sorted = [...insights].sort((a, b) => {
      const sevDiff = (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5);
      if (sevDiff !== 0) return sevDiff;
      const typeDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
      if (typeDiff !== 0) return typeDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    if (!selectedServiceId) return sorted;
    return sorted.filter(
      (insight) =>
        insight.targetServiceId === selectedServiceId ||
        insight.targetDatabaseId === selectedServiceId ||
        insight.targetModuleId === selectedServiceId ||
        insight.targetMethodId === selectedServiceId,
    );
  }, [insights, selectedServiceId]);

  return {
    insights: filteredInsights,
    allInsights: insights,
    isLoading,
    error,
    refetch: fetchInsights,
  };
}
