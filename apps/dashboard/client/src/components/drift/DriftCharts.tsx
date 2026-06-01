/**
 * Drift analytics charts for the verify page's left pane, mirroring analyze's
 * analytics (TypePieChart / SeverityBarChart / CodeHotspots / TrendChart). All
 * are clickable to filter the drift list. Severity reuses analyze's
 * `SeverityBarChart` directly; these cover by-artifact-kind (a donut matching
 * analyze's category pie), top-files, and the per-run drift trend.
 */

import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Label, Pie, PieChart, Sector, XAxis, YAxis } from 'recharts';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { humanizeKind } from './driftType';
import type { VerifyHistory } from '@/lib/api';

// ---------------------------------------------------------------------------
// By artifact kind — clickable donut (mirrors analyze's TypePieChart)
// ---------------------------------------------------------------------------

const RADIAN = Math.PI / 180;

// Cycle the same chart palette analyze uses for category slices.
const KIND_PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

function buildKindConfig(byKind: Record<string, number>): ChartConfig {
  const config: ChartConfig = {};
  Object.keys(byKind).forEach((kind, i) => {
    config[kind] = { label: humanizeKind(kind), color: KIND_PALETTE[i % KIND_PALETTE.length] };
  });
  return config;
}

type SliceShape = {
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  fill: string;
  name?: string;
  percent?: number;
};

function renderActiveShape(props: unknown) {
  // Pop the active slice outward; labels are rendered uniformly by the `label`
  // prop so non-active slices keep theirs.
  const p = props as SliceShape;
  return (
    <Sector
      cx={p.cx}
      cy={p.cy}
      innerRadius={p.innerRadius}
      outerRadius={p.outerRadius + 10}
      startAngle={p.startAngle}
      endAngle={p.endAngle}
      fill={p.fill}
    />
  );
}

export function DriftKindChart({
  byKind,
  activeKind,
  onKindClick,
}: {
  byKind: Record<string, number>;
  activeKind?: string | null;
  onKindClick?: (kind: string) => void;
}) {
  // Stable identity across re-renders that only change `activeKind`, so
  // recharts doesn't replay its mount animation (which hides labels).
  const chartData = useMemo(
    () =>
      Object.entries(byKind)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value })),
    [byKind],
  );
  const config = useMemo(() => buildKindConfig(byKind), [byKind]);
  const total = useMemo(() => chartData.reduce((sum, d) => sum + d.value, 0), [chartData]);

  if (chartData.length === 0) return null;

  const activeIdx = activeKind ? chartData.findIndex((d) => d.name === activeKind) : -1;

  const renderLabel = (props: unknown) => {
    const p = props as SliceShape & { midAngle: number; index: number };
    const isActive = activeIdx >= 0 && p.index === activeIdx;
    const labelRadius = (p.outerRadius + (isActive ? 10 : 0)) * 1.18;
    const x = p.cx + labelRadius * Math.cos(-p.midAngle * RADIAN);
    const y = p.cy + labelRadius * Math.sin(-p.midAngle * RADIAN);
    const textAnchor = Math.cos(-p.midAngle * RADIAN) >= 0 ? 'start' : 'end';
    const pct = p.percent !== undefined ? ` ${(p.percent * 100).toFixed(0)}%` : '';
    const label = p.name ? humanizeKind(p.name) : '';
    return (
      <text
        x={x}
        y={y}
        textAnchor={textAnchor}
        dominantBaseline="central"
        className={isActive ? 'fill-foreground text-xs font-medium' : 'fill-muted-foreground text-[10px]'}
      >
        {label}
        {pct}
      </text>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">By Artifact Kind</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={config}
          className={`aspect-square w-full max-h-[250px] ${onKindClick ? '[&_.recharts-pie]:cursor-pointer' : ''}`}
        >
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="40%"
              outerRadius="70%"
              paddingAngle={2}
              label={renderLabel}
              labelLine={false}
              activeIndex={activeIdx >= 0 ? activeIdx : -1}
              activeShape={renderActiveShape}
              onClick={onKindClick ? (d: { name?: string }) => d.name && onKindClick(d.name) : undefined}
              isAnimationActive={false}
            >
              {chartData.map((entry, i) => (
                <Cell
                  key={entry.name}
                  fill={`var(--color-${entry.name})`}
                  opacity={activeIdx < 0 || i === activeIdx ? 1 : 0.45}
                />
              ))}
              <Label value={total} position="center" className="fill-foreground text-lg font-bold" />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top files — clickable table (mirrors analyze's CodeHotspots)
// ---------------------------------------------------------------------------

export function DriftTopFiles({
  byFile,
  activeFile,
  onFileClick,
}: {
  byFile: Record<string, number>;
  activeFile?: string | null;
  onFileClick?: (filePath: string) => void;
}) {
  const entries = Object.entries(byFile)
    .map(([filePath, count]) => ({ filePath, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Top Files</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <table className="w-full text-sm">
          <tbody>
            {entries.map((entry, i) => {
              const fileName = entry.filePath.split('/').pop() || entry.filePath;
              const isActive = activeFile === entry.filePath;
              return (
                <tr
                  key={entry.filePath}
                  className={`border-b border-border/50 transition-colors ${onFileClick ? 'cursor-pointer hover:bg-muted/50' : ''} ${isActive ? 'bg-accent/50' : ''}`}
                  onClick={() => onFileClick?.(entry.filePath)}
                  title={entry.filePath}
                >
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <span className="block max-w-[220px] truncate" title={entry.filePath}>{fileName}</span>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums">{entry.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Drift trend — drift count per run over time (mirrors analyze's TrendChart)
// ---------------------------------------------------------------------------

const TREND_CONFIG: ChartConfig = { drifts: { label: 'Drifts', color: 'var(--chart-1)' } };

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function DriftTrendChart({ history }: { history: VerifyHistory }) {
  const points = history.runs.map((r) => ({ drifts: r.driftCount, dateLabel: formatDate(r.verifiedAt) }));

  if (points.length === 0) return null;

  const trend = points.length >= 2 ? points[points.length - 1].drifts - points[points.length - 2].drifts : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Drift Trend</CardTitle>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {trend > 0 && <><TrendingUp className="h-3.5 w-3.5 text-red-400" /> +{trend}</>}
          {trend < 0 && <><TrendingDown className="h-3.5 w-3.5 text-green-400" /> {trend}</>}
          {trend === 0 && <><Minus className="h-3.5 w-3.5" /> No change</>}
        </div>
      </CardHeader>
      <CardContent>
        {points.length === 1 ? (
          <div className="flex flex-col items-center gap-1 py-6 text-center">
            <p className="text-2xl font-bold">{points[0].drifts}</p>
            <p className="text-xs text-muted-foreground">Drifts in your first verify run — run more to see the trend.</p>
          </div>
        ) : (
          <ChartContainer config={TREND_CONFIG} className="w-full" style={{ aspectRatio: 'auto', height: 200 }}>
            <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="dateLabel" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="drifts"
                type="monotone"
                fill="var(--color-drifts)"
                fillOpacity={0.15}
                stroke="var(--color-drifts)"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
