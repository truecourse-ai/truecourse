
import { useState, useEffect, useCallback, useMemo } from 'react';
import * as api from '@/lib/api';
import type { ViolationResponse } from '@/lib/api';

export function useViolations(repoId: string, selectedServiceId?: string, analysisId?: string) {
  const [violations, setViolations] = useState<ViolationResponse[]>([]);
  const [codeViolations, setCodeViolations] = useState<ViolationResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchViolations = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [archData, codeData] = await Promise.all([
        api.getViolations(repoId, analysisId),
        api.getCodeViolations(repoId, undefined, analysisId),
      ]);
      setViolations(archData);
      // Normalize code violations into ViolationResponse shape
      setCodeViolations(codeData.map((cv) => ({
        id: cv.id,
        type: 'code',
        title: cv.title,
        content: cv.content,
        severity: cv.severity,
        targetServiceId: null,
        targetServiceName: null,
        targetDatabaseId: null,
        targetDatabaseName: null,
        targetModuleId: null,
        targetModuleName: null,
        targetMethodId: null,
        targetMethodName: null,
        targetTable: null,
        fixPrompt: cv.fixPrompt || null,
        createdAt: new Date().toISOString(),
        // Code-specific fields
        filePath: cv.filePath,
        lineStart: cv.lineStart,
        ruleKey: cv.ruleKey,
      } as ViolationResponse)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch violations');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, analysisId]);

  useEffect(() => {
    fetchViolations();
  }, [fetchViolations]);

  const allCombined = useMemo(() => [...violations, ...codeViolations], [violations, codeViolations]);

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
      code: 4,
    };
    const sorted = [...allCombined].sort((a, b) => {
      const sevDiff = (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5);
      if (sevDiff !== 0) return sevDiff;
      const typeDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
      if (typeDiff !== 0) return typeDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    if (!selectedServiceId) return sorted;
    return sorted.filter(
      (violation) =>
        violation.type === 'code' || // code violations aren't tied to graph nodes
        violation.targetServiceId === selectedServiceId ||
        violation.targetDatabaseId === selectedServiceId ||
        violation.targetModuleId === selectedServiceId ||
        violation.targetMethodId === selectedServiceId,
    );
  }, [allCombined, selectedServiceId]);

  return {
    violations: filteredViolations,
    allViolations: allCombined,
    isLoading,
    error,
    refetch: fetchViolations,
  };
}
