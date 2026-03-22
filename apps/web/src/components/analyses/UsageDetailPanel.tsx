import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getAnalysisUsage, type AnalysisUsageRow } from '@/lib/api';

type UsageDetailPanelProps = {
  repoId: string;
  analysisId: string;
  onBack: () => void;
};

function formatTokens(n: number): string {
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatDuration(ms: number): string {
  if (ms === 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function formatCost(cost: string | null): string {
  if (!cost) return '-';
  const n = parseFloat(cost);
  if (isNaN(n)) return '-';
  return `$${n.toFixed(4)}`;
}

const callTypeLabels: Record<string, string> = {
  service: 'Service',
  database: 'Database',
  module: 'Module',
  code: 'Code',
  enrichment: 'Enrichment',
  flow: 'Flow',
};

export function UsageDetailPanel({ repoId, analysisId, onBack }: UsageDetailPanelProps) {
  const [rows, setRows] = useState<AnalysisUsageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    getAnalysisUsage(repoId, analysisId)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setIsLoading(false));
  }, [repoId, analysisId]);

  const totals = rows.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + r.cacheWriteTokens,
      totalTokens: acc.totalTokens + r.totalTokens,
      durationMs: acc.durationMs + r.durationMs,
      costUsd: r.costUsd
        ? acc.costUsd + parseFloat(r.costUsd)
        : acc.costUsd,
      hasCost: acc.hasCost || r.costUsd !== null,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, costUsd: 0, hasCost: false },
  );

  const provider = rows.length > 0 ? rows[0].provider : null;
  const hasCacheTokens = rows.some((r) => r.cacheReadTokens > 0 || r.cacheWriteTokens > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
        <button
          className="rounded p-1 hover:bg-accent text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">Usage Detail</span>
        {provider && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground ml-auto">
            {provider}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          No usage data recorded
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/50">
                  <th className="px-4 py-2.5 font-medium">Call Type</th>
                  <th className="px-4 py-2.5 font-medium text-right">Input</th>
                  <th className="px-4 py-2.5 font-medium text-right">Output</th>
                  {hasCacheTokens && (
                    <>
                      <th className="px-4 py-2.5 font-medium text-right">Cache Read</th>
                      <th className="px-4 py-2.5 font-medium text-right">Cache Write</th>
                    </>
                  )}
                  <th className="px-4 py-2.5 font-medium text-right">Total</th>
                  <th className="px-4 py-2.5 font-medium text-right">Duration</th>
                  {totals.hasCost && <th className="px-4 py-2.5 font-medium text-right">Cost</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="px-4 py-2.5">{callTypeLabels[r.callType] || r.callType}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{formatTokens(r.inputTokens)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{formatTokens(r.outputTokens)}</td>
                    {hasCacheTokens && (
                      <>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{r.cacheReadTokens > 0 ? formatTokens(r.cacheReadTokens) : '-'}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{r.cacheWriteTokens > 0 ? formatTokens(r.cacheWriteTokens) : '-'}</td>
                      </>
                    )}
                    <td className="px-4 py-2.5 text-right font-medium">{formatTokens(r.totalTokens)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{formatDuration(r.durationMs)}</td>
                    {totals.hasCost && <td className="px-4 py-2.5 text-right text-green-400">{formatCost(r.costUsd)}</td>}
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="border-t border-border bg-muted/30 font-medium">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right">{formatTokens(totals.inputTokens)}</td>
                  <td className="px-4 py-2.5 text-right">{formatTokens(totals.outputTokens)}</td>
                  {hasCacheTokens && (
                    <>
                      <td className="px-4 py-2.5 text-right">{formatTokens(totals.cacheReadTokens)}</td>
                      <td className="px-4 py-2.5 text-right">{formatTokens(totals.cacheWriteTokens)}</td>
                    </>
                  )}
                  <td className="px-4 py-2.5 text-right">{formatTokens(totals.totalTokens)}</td>
                  <td className="px-4 py-2.5 text-right">{formatDuration(totals.durationMs)}</td>
                  {totals.hasCost && <td className="px-4 py-2.5 text-right text-green-400">{formatCost(String(totals.costUsd))}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
