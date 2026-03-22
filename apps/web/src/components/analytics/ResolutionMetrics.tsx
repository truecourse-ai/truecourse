import type { ResolutionResponse } from '@/lib/api';
import { Clock, CheckCircle2, AlertTriangle, Activity, TrendingUp } from 'lucide-react';

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.round(ms / (1000 * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  if (remainingHours === 0) return `${days}d`;
  return `${days}d ${remainingHours}h`;
}

const tooltipClass = 'pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md border border-border opacity-0 group-hover:opacity-100 transition-opacity z-50';

export function ResolutionMetrics({ data }: { data: ResolutionResponse }) {
  const ratePercent = Math.round(data.resolutionRate * 100);

  return (
    <div className="flex items-center gap-3">
      <div className="group relative flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1">
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold">{formatDuration(data.avgTimeToResolveMs)}</span>
        <span className="text-[10px] text-muted-foreground">resolve</span>
        <span className={tooltipClass}>Average time from first detection to resolution</span>
      </div>

      <div className="group relative flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-400" />
        <span className="text-xs font-semibold">{data.totalResolved}</span>
        <span className="text-[10px] text-muted-foreground">resolved</span>
        <span className={tooltipClass}>Total violations fixed across all analyses</span>
      </div>

      <div className="group relative flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1">
        <Activity className="h-3.5 w-3.5 shrink-0 text-blue-400" />
        <span className="text-xs font-semibold">{data.totalActive}</span>
        <span className="text-[10px] text-muted-foreground">active</span>
        <span className={tooltipClass}>Currently open violations in the latest analysis</span>
      </div>

      <div className="group relative flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
        <span className={`text-xs font-semibold ${data.staleCount > 0 ? 'text-yellow-400' : ''}`}>
          {data.staleCount}
        </span>
        <span className="text-[10px] text-muted-foreground">stale</span>
        <span className={tooltipClass}>Active violations unresolved for more than {data.staleDays} days</span>
      </div>

      <div className="group relative flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1">
        <TrendingUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold">{ratePercent}%</span>
        <span className="text-[10px] text-muted-foreground">rate</span>
        <span className={tooltipClass}>Percentage of all detected violations that have been resolved</span>
      </div>
    </div>
  );
}
