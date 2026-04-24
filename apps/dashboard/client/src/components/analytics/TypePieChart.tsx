import { useMemo } from 'react';
import { Pie, PieChart, Cell, Label, Sector } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BreakdownResponse } from '@/lib/api';

const RADIAN = Math.PI / 180;

/**
 * Category colors for the pie slices. Keys must match the category slug
 * emitted by the server (first segment of `rule_key`).
 */
const CATEGORY_LABELS: Record<string, string> = {
  security: 'Security',
  bugs: 'Bugs',
  architecture: 'Architecture',
  performance: 'Performance',
  reliability: 'Reliability',
  'code-quality': 'Code Quality',
  database: 'Database',
  style: 'Style',
};

const CATEGORY_COLORS: Record<string, string> = {
  security: 'var(--chart-1)',
  bugs: 'var(--chart-2)',
  architecture: 'var(--chart-3)',
  performance: 'var(--chart-4)',
  reliability: 'var(--chart-5)',
  'code-quality': 'var(--chart-1)',
  database: 'var(--chart-2)',
  style: 'var(--chart-3)',
};

function buildConfig(byCategory: Record<string, number>): ChartConfig {
  const config: ChartConfig = {};
  for (const cat of Object.keys(byCategory)) {
    config[cat] = {
      label: CATEGORY_LABELS[cat] ?? cat,
      color: CATEGORY_COLORS[cat] ?? 'var(--chart-1)',
    };
  }
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
  // Pop the active slice outward by a few pixels. Labels are handled
  // uniformly by the `label` prop below — this shape renders geometry only
  // so non-active slices' labels aren't accidentally suppressed.
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

export function TypePieChart({
  data,
  activeCategory,
  onCategoryClick,
}: {
  data: BreakdownResponse;
  activeCategory?: string | null;
  onCategoryClick?: (category: string) => void;
}) {
  const { byCategory, total } = data;

  // Memoize so chartData / config keep stable identity across re-renders
  // (e.g. when only activeCategory changes). Recharts re-runs its mount
  // animation whenever `data` prop identity changes, which hides labels
  // for the duration — so keeping it stable prevents that flicker on click.
  const chartData = useMemo(
    () =>
      Object.entries(byCategory)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value })),
    [byCategory],
  );
  const config = useMemo(() => buildConfig(byCategory), [byCategory]);

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">By Category</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No violations to display.</p>
        </CardContent>
      </Card>
    );
  }

  const activeIdx = activeCategory ? chartData.findIndex((d) => d.name === activeCategory) : -1;

  const handlePieClick = (d: { name?: string }) => {
    if (d.name) onCategoryClick?.(d.name);
  };

  // Render labels for every slice — active slice's label sits just outside the
  // popped-out sector, non-active labels at their original outer radius.
  const renderLabel = (props: unknown) => {
    const p = props as SliceShape & { midAngle: number; index: number };
    const isActive = activeIdx >= 0 && p.index === activeIdx;
    const labelRadius = (p.outerRadius + (isActive ? 10 : 0)) * 1.18;
    const x = p.cx + labelRadius * Math.cos(-p.midAngle * RADIAN);
    const y = p.cy + labelRadius * Math.sin(-p.midAngle * RADIAN);
    const textAnchor = Math.cos(-p.midAngle * RADIAN) >= 0 ? 'start' : 'end';
    const pct = p.percent !== undefined ? ` ${(p.percent * 100).toFixed(0)}%` : '';
    const label = p.name ? (CATEGORY_LABELS[p.name] ?? p.name) : '';
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
        <CardTitle className="text-sm font-medium">By Category</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={config}
          className={`aspect-square w-full max-h-[250px] ${onCategoryClick ? '[&_.recharts-pie]:cursor-pointer' : ''}`}
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
              onClick={onCategoryClick ? handlePieClick : undefined}
              isAnimationActive={false}
            >
              {chartData.map((entry, i) => (
                <Cell
                  key={entry.name}
                  fill={`var(--color-${entry.name})`}
                  opacity={activeIdx < 0 || i === activeIdx ? 1 : 0.45}
                />
              ))}
              <Label
                value={total}
                position="center"
                className="fill-foreground text-lg font-bold"
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
