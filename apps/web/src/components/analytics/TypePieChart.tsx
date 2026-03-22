import { Pie, PieChart, Cell, Label } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BreakdownResponse } from '@/lib/api';

const TYPE_COLORS: Record<string, string> = {
  service: 'var(--chart-1)',
  module: 'var(--chart-2)',
  function: 'var(--chart-3)',
  database: 'var(--chart-4)',
  code: 'var(--chart-5)',
  architecture: 'var(--chart-1)',
  dependency: 'var(--chart-2)',
};

function buildConfig(byType: Record<string, number>): ChartConfig {
  const config: ChartConfig = {};
  for (const type of Object.keys(byType)) {
    config[type] = {
      label: type.charAt(0).toUpperCase() + type.slice(1),
      color: TYPE_COLORS[type] ?? 'var(--chart-1)',
    };
  }
  return config;
}

export function TypePieChart({ data }: { data: BreakdownResponse }) {
  const { byType, total } = data;
  const entries = Object.entries(byType).filter(([, v]) => v > 0);

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">By Type</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No violations to display.</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = entries.map(([name, value]) => ({ name, value }));
  const config = buildConfig(byType);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">By Type</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-square w-full max-h-[250px]">
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
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={`var(--color-${entry.name})`}
                />
              ))}
              <Label
                value={total}
                position="center"
                className="fill-foreground text-lg font-bold"
              />
            </Pie>
            <ChartLegend content={<ChartLegendContent nameKey="name" />} />
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
