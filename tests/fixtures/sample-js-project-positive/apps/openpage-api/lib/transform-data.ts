
// [unknown-catch-variable] catch(error) — variable not accessed; returns empty fallback
declare function fetchMetricsSeries(metric: string, range: { from: Date; to: Date }): Promise<Array<[string, Record<string, number>]>>;
declare const FRIENDLY_METRIC_NAMES: Record<string, string>;

interface ChartData {
  labels: string[];
  datasets: Array<{ label: string; data: number[] }>;
}

async function buildMetricsChartData(metric: string, range: { from: Date; to: Date }): Promise<ChartData> {
  try {
    const entries = await fetchMetricsSeries(metric, range);
    const labels = entries.map(([dateStr]) => {
      try {
        return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(dateStr));
      } catch (error) {
        console.error('Error formatting date:', error, dateStr);
        return dateStr;
      }
    });
    return {
      labels,
      datasets: [{ label: `Total ${FRIENDLY_METRIC_NAMES[metric] ?? metric}`, data: entries.map(([, stats]) => stats[metric] ?? 0) }],
    };
  } catch (error) {
    return {
      labels: [],
      datasets: [{ label: `Total ${FRIENDLY_METRIC_NAMES[metric] ?? metric}`, data: [] }],
    };
  }
}



// FP shape: metricsMap is a typed Record keyed by metric enum values;
// metric variable comes from Object.keys iteration over the same map, so the key always exists.
// This is object property access on a Record, not array indexing.
declare const enum AnalyticsMetric { VIEWS = 'VIEWS', CLICKS = 'CLICKS', CONVERSIONS = 'CONVERSIONS' }

interface MetricStats { count: number; delta: number }

function aggregateMetrics(
  rows: Array<{ metric: AnalyticsMetric; count: number }>,
): Record<AnalyticsMetric, MetricStats> {
  const stats: Record<AnalyticsMetric, MetricStats> = {
    [AnalyticsMetric.VIEWS]: { count: 0, delta: 0 },
    [AnalyticsMetric.CLICKS]: { count: 0, delta: 0 },
    [AnalyticsMetric.CONVERSIONS]: { count: 0, delta: 0 },
  };

  for (const row of rows) {
    const metric = row.metric;
    stats[metric].count += row.count;
  }

  return stats;
}
