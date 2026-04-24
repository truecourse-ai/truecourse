import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BreakdownResponse } from '@/lib/api';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ef4444',
  medium: '#f97316',
  low: '#f59e0b',
  info: '#3b82f6',
};

const chartConfig: ChartConfig = {
  count: { label: 'Violations' },
  critical: { label: 'Critical', color: SEVERITY_COLORS.critical },
  high: { label: 'High', color: SEVERITY_COLORS.high },
  medium: { label: 'Medium', color: SEVERITY_COLORS.medium },
  low: { label: 'Low', color: SEVERITY_COLORS.low },
  info: { label: 'Info', color: SEVERITY_COLORS.info },
};

export function SeverityBarChart({
  data,
  activeSeverity,
  onSeverityClick,
}: {
  data: BreakdownResponse;
  activeSeverity?: string | null;
  onSeverityClick?: (severity: string) => void;
}) {
  const { bySeverity } = data;

  const chartData = SEVERITY_ORDER
    .filter((sev) => (bySeverity[sev] ?? 0) > 0)
    .map((sev) => ({
      severity: sev.charAt(0).toUpperCase() + sev.slice(1),
      severityKey: sev,
      count: bySeverity[sev] ?? 0,
      fill: SEVERITY_COLORS[sev],
    }));

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">By Severity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No violations to display.</p>
        </CardContent>
      </Card>
    );
  }

  const handleBarClick = (d: { severityKey?: string }) => {
    if (d.severityKey) onSeverityClick?.(d.severityKey);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">By Severity</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[2/1] w-full max-h-[250px]">
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="severity" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} width={32} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="count"
              radius={[4, 4, 0, 0]}
              onClick={onSeverityClick ? handleBarClick : undefined}
              style={onSeverityClick ? { cursor: 'pointer' } : undefined}
              isAnimationActive={false}
            >
              {chartData.map((d) => (
                <Cell
                  key={d.severityKey}
                  fill={d.fill}
                  opacity={!activeSeverity || activeSeverity === d.severityKey ? 1 : 0.35}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
