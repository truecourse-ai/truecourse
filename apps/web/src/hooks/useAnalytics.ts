import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/api';
import type {
  TrendResponse,
  BreakdownResponse,
  TopOffendersResponse,
  ResolutionResponse,
  CodeViolationSummary,
} from '@/lib/api';

export function useAnalytics(repoId: string, branch?: string, analysisId?: string) {
  const [trend, setTrend] = useState<TrendResponse | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownResponse | null>(null);
  const [topOffenders, setTopOffenders] = useState<TopOffendersResponse | null>(null);
  const [resolution, setResolution] = useState<ResolutionResponse | null>(null);
  const [codeHotspots, setCodeHotspots] = useState<CodeViolationSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [trendData, breakdownData, offendersData, resolutionData, hotspotsData] = await Promise.all([
        api.getAnalyticsTrend(repoId, branch),
        api.getAnalyticsBreakdown(repoId, branch, analysisId),
        api.getAnalyticsTopOffenders(repoId, branch, analysisId),
        api.getAnalyticsResolution(repoId, branch),
        api.getCodeViolationSummary(repoId, analysisId),
      ]);
      setTrend(trendData);
      setBreakdown(breakdownData);
      setTopOffenders(offendersData);
      setResolution(resolutionData);
      setCodeHotspots(hotspotsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, branch, analysisId]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return {
    trend,
    breakdown,
    topOffenders,
    resolution,
    codeHotspots,
    isLoading,
    error,
    refetch: fetchAnalytics,
  };
}
