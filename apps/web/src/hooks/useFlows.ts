import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/api';
import type { FlowResponse } from '@/lib/api';

export function useFlows(repoId: string, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const [flows, setFlows] = useState<FlowResponse[]>([]);
  const [severities, setSeverities] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!repoId) return;
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.getFlows(repoId);
      setFlows(result.flows);
      setSeverities(result.severities);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch flows');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, enabled]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { flows, severities, isLoading, error, refetch };
}
