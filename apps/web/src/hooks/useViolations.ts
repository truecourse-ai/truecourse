
import { useState, useEffect, useCallback, useMemo } from 'react';
import * as api from '@/lib/api';
import type { ViolationResponse } from '@/lib/api';

export function useViolations(repoId: string, selectedServiceId?: string, analysisId?: string) {
  const [violations, setViolations] = useState<ViolationResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchViolations = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getViolations(repoId, analysisId);
      setViolations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch violations');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, analysisId]);

  useEffect(() => {
    fetchViolations();
  }, [fetchViolations]);

  const filteredViolations = useMemo(() => {
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
    const sorted = [...violations].sort((a, b) => {
      const sevDiff = (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5);
      if (sevDiff !== 0) return sevDiff;
      const typeDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
      if (typeDiff !== 0) return typeDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    if (!selectedServiceId) return sorted;
    return sorted.filter(
      (violation) =>
        violation.targetServiceId === selectedServiceId ||
        violation.targetDatabaseId === selectedServiceId ||
        violation.targetModuleId === selectedServiceId ||
        violation.targetMethodId === selectedServiceId,
    );
  }, [violations, selectedServiceId]);

  return {
    violations: filteredViolations,
    allViolations: violations,
    isLoading,
    error,
    refetch: fetchViolations,
  };
}
