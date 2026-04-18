import { useState } from 'react';
import { Loader2, Trash2, Coins } from 'lucide-react';
import type { AnalysisSummary } from '@/lib/api';
import { UsageDetailPanel } from './UsageDetailPanel';

type AnalysesPanelProps = {
  analyses: AnalysisSummary[];
  isLoading: boolean;
  currentAnalysisId?: string;
  selectedAnalysisId?: string | null;
  onSelectAnalysis: (analysisId: string | null) => void;
  onDeleteAnalysis: (analysisId: string) => Promise<void>;
  repoId: string;
};

const severityColors: Record<string, string> = {
  critical: 'text-red-500 dark:text-red-500',
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-orange-600 dark:text-orange-400',
  low: 'text-amber-600 dark:text-amber-400',
  info: 'text-gray-500 dark:text-gray-400',
};

const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];

const severityBarColors: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-red-400',
  medium: 'bg-orange-400',
  low: 'bg-amber-400',
  info: 'bg-gray-400',
};

function SeverityBadges({ counts }: { counts?: Record<string, number> }) {
  if (!counts) return null;
  const entries = severityOrder
    .filter((s) => counts[s] && counts[s] > 0)
    .map((s) => ({ severity: s, count: counts[s] }));
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  if (total === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <div className="flex flex-col gap-1 min-w-[60px]">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium">{total}</span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {entries.map(({ severity, count }) => (
            <span key={severity} className={severityColors[severity]} title={`${severity}: ${count}`}>
              {count}
            </span>
          ))}
        </span>
      </div>
      <div className="flex h-1 w-full overflow-hidden rounded-full bg-muted">
        {entries.map(({ severity, count }) => (
          <div
            key={severity}
            className={`${severityBarColors[severity]} h-full`}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${severity}: ${count}`}
          />
        ))}
      </div>
    </div>
  );
}

function formatDuration(ms?: number): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function formatTokens(n?: number): string {
  if (!n) return '-';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}


function formatDateTime(dateStr: string): { date: string; time: string } {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
}

export function AnalysesPanel({
  analyses,
  isLoading,
  currentAnalysisId,
  selectedAnalysisId,
  onSelectAnalysis,
  onDeleteAnalysis,
  repoId,
}: AnalysesPanelProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [usageAnalysisId, setUsageAnalysisId] = useState<string | null>(null);

  if (usageAnalysisId) {
    return (
      <UsageDetailPanel
        repoId={repoId}
        analysisId={usageAnalysisId}
        onBack={() => setUsageAnalysisId(null)}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No analyses yet. Run an analysis to see results here.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-4 flex items-center gap-4">
        <h2 className="text-lg font-semibold">Analyses</h2>
        <span className="text-sm text-muted-foreground">{analyses.length} total</span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">Branch</th>
              <th className="px-4 py-2.5 font-medium">Provider</th>
              <th className="px-4 py-2.5 font-medium text-center">Services</th>
              <th className="px-4 py-2.5 font-medium">Violations</th>
              <th className="px-4 py-2.5 font-medium text-right">Duration</th>
              <th className="px-4 py-2.5 font-medium text-right">Tokens</th>
              <th className="px-4 py-2.5 font-medium text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((a, i) => {
              const isLatest = i === 0;
              const isViewing = a.id === currentAnalysisId;
              const { date, time } = formatDateTime(a.createdAt);

              // Click logic: latest always sets null (null = latest convention),
              // old analyses toggle between their ID and null
              const handleClick = () => {
                if (isLatest) {
                  onSelectAnalysis(null);
                } else {
                  onSelectAnalysis(selectedAnalysisId === a.id ? null : a.id);
                }
              };

              return (
                <tr
                  key={a.id}
                  className={`border-b border-border/50 transition-colors cursor-pointer ${
                    isViewing
                      ? 'bg-primary/10'
                      : 'hover:bg-accent/30'
                  }`}
                  onClick={handleClick}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{date}</span>
                        <span className="text-[11px] text-muted-foreground">{time}</span>
                      </div>
                      {i === 0 && a.status === 'completed' && (
                        <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          latest
                        </span>
                      )}
                      {a.status === 'running' && (
                        <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">
                          running
                        </span>
                      )}
                      {a.status === 'cancelling' && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                          cancelling
                        </span>
                      )}
                      {a.status === 'cancelled' && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          cancelled
                        </span>
                      )}
                      {a.status === 'failed' && (
                        <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          failed
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {a.branch ? (
                      <span className="font-mono text-xs">{a.branch}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                    {a.commitHash && (
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{a.commitHash.slice(0, 7)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.provider ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {a.provider}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs">
                    {a.serviceCount ?? '-'}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <SeverityBadges counts={a.violationsBySeverity} />
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                    {formatDuration(a.durationMs)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                    {formatTokens(a.totalTokens)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      {a.totalTokens != null && a.totalTokens > 0 && (
                        <button
                          className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title="View usage breakdown"
                          onClick={(e) => {
                            e.stopPropagation();
                            setUsageAnalysisId(a.id);
                          }}
                        >
                          <Coins className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete analysis"
                        disabled={deletingId === a.id}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm('Delete this analysis and all its data?')) return;
                          setDeletingId(a.id);
                          try {
                            await onDeleteAnalysis(a.id);
                          } finally {
                            setDeletingId(null);
                          }
                        }}
                      >
                        {deletingId === a.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
