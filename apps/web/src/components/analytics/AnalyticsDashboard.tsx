import { useAnalytics } from '@/hooks/useAnalytics';
import { TrendChart } from './TrendChart';
import { TypePieChart } from './TypePieChart';
import { SeverityBarChart } from './SeverityBarChart';
import { TopOffendersTable } from './TopOffendersTable';
import { ResolutionMetrics } from './ResolutionMetrics';
import { CodeHotspots } from './CodeHotspots';
import { Loader2, RefreshCw } from 'lucide-react';
import type { TopOffender } from '@/lib/api';

export function AnalyticsDashboard({
  repoId,
  branch,
  onNavigateToNode,
  onOpenFile,
}: {
  repoId: string;
  branch?: string;
  onNavigateToNode?: (nodeId: string, kind: 'service' | 'module') => void;
  onOpenFile?: (filePath: string) => void;
}) {
  const { trend, breakdown, topOffenders, resolution, codeHotspots, isLoading, error, refetch } =
    useAnalytics(repoId, branch);

  const handleNavigate = (offender: TopOffender) => {
    onNavigateToNode?.(offender.id, offender.kind);
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-4 flex items-center gap-4">
        <h2 className="text-lg font-semibold">Analytics</h2>
        {resolution && <ResolutionMetrics data={resolution} />}
        <button
          onClick={refetch}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="grid gap-4">

        {/* Trend chart — full width */}
        {trend && <TrendChart data={trend} />}

        {/* Type + Severity — side by side */}
        <div className="grid gap-4 md:grid-cols-2">
          {breakdown && <TypePieChart data={breakdown} />}
          {breakdown && <SeverityBarChart data={breakdown} />}
        </div>

        {/* Top Offenders + Code Hotspots — side by side */}
        <div className="grid gap-4 md:grid-cols-2 items-start">
          {topOffenders && (
            <TopOffendersTable data={topOffenders} onNavigate={handleNavigate} />
          )}
          {codeHotspots && (
            <CodeHotspots data={codeHotspots} onOpenFile={onOpenFile} />
          )}
        </div>
      </div>
    </div>
  );
}
