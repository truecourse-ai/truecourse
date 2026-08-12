import { Area, AreaChart, CartesianGrid, ReferenceDot, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TrendResponse } from '@/lib/api';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const chartConfig = {
  total: { label: 'Total Active', color: 'var(--chart-1)' },
  new: { label: 'New', color: 'var(--color-destructive, #ef4444)' },
  resolved: { label: 'Resolved', color: 'var(--chart-3)' },
} satisfies ChartConfig;

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function TrendChart({
  data,
  selectedAnalysisId,
}: {
  data: TrendResponse;
  /** When set and present in the trend data, renders a highlighted ring at
   *  that point so the user can see which analysis they're inspecting. */
  selectedAnalysisId?: string;
}) {
  const { points } = data;

  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Violation Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No analyses found. Run an analysis to see trends.</p>
        </CardContent>
      </Card>
    );
  }

  // Compute active count (total minus resolved) for trend display
  const chartData = points.map((p) => ({
    ...p,
    active: p.total - p.resolved,
    dateLabel: formatDate(p.date),
  }));

  const selectedPoint = selectedAnalysisId
    ? chartData.find((p) => p.analysisId === selectedAnalysisId)
    : undefined;

  // Trend indicator
  const trendDirection =
    chartData.length >= 2
      ? chartData[chartData.length - 1].active - chartData[chartData.length - 2].active
      : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Violation Trend</CardTitle>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {trendDirection > 0 && <><TrendingUp className="h-3.5 w-3.5 text-red-400" /> +{trendDirection}</>}
          {trendDirection < 0 && <><TrendingDown className="h-3.5 w-3.5 text-green-400" /> {trendDirection}</>}
          {trendDirection === 0 && <><Minus className="h-3.5 w-3.5" /> No change</>}
        </div>
      </CardHeader>
      <CardContent>
        {points.length === 1 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-2xl font-bold">{chartData[0].active}</p>
            <p className="text-sm text-muted-foreground">Active violations in your first analysis</p>
            <p className="text-xs text-muted-foreground">Run more analyses to see trends over time</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="w-full" style={{ aspectRatio: 'auto', height: 250 }}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="dateLabel" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} width={32} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_value, payload) => {
                      const point = payload?.[0]?.payload;
                      return point ? formatDate(point.date) : '';
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                dataKey="active"
                name="total"
                type="monotone"
                fill="var(--color-total)"
                fillOpacity={0.15}
                stroke="var(--color-total)"
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                dataKey="new"
                type="monotone"
                fill="var(--color-new)"
                fillOpacity={0.1}
                stroke="var(--color-new)"
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                dataKey="resolved"
                type="monotone"
                fill="var(--color-resolved)"
                fillOpacity={0.1}
                stroke="var(--color-resolved)"
                strokeWidth={2}
                isAnimationActive={false}
              />
              {selectedPoint && (
                <ReferenceDot
                  x={selectedPoint.dateLabel}
                  y={selectedPoint.active}
                  r={6}
                  fill="var(--color-total)"
                  stroke="var(--background)"
                  strokeWidth={2}
                  ifOverflow="visible"
                />
              )}
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
