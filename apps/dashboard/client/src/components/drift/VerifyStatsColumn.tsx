/**
 * Analytics pane (left of the 3-column verify view), mirroring analyze's
 * analytics aside: summary badge chips (like `ResolutionMetrics` / `DiffAside`)
 * over a scrollable stack of charts (trend, by-severity, by-kind, top files)
 * where clicking a bar / slice / row filters the drift list. In Git Diff mode
 * the breakdowns are computed over the added drifts.
 */

import { AlertTriangle, FileText, Boxes, Activity, PlusCircle, CheckCircle2, AlertCircle, GitCompare } from 'lucide-react';
import { HoverPopover } from '@/components/ui/hover-popover';
import { SeverityBarChart } from '@/components/analytics/SeverityBarChart';
import { DriftKindChart, DriftTopFiles, DriftTrendChart } from './DriftCharts';
import { driftType } from './driftType';
import type { ContractDrift, DriftSeverity, VerifyState, VerifyDiff, VerifyHistory } from '@/lib/api';

export interface DriftFilters {
  severity: DriftSeverity | null;
  kind: string | null;
  file: string | null;
}

interface Props {
  state: VerifyState | null;
  diff: VerifyDiff | null;
  history: VerifyHistory;
  mode: 'current' | 'diff';
  isDiffing: boolean;
  filters: DriftFilters;
  onToggleSeverity: (s: string) => void;
  onToggleKind: (k: string) => void;
  onToggleFile: (f: string) => void;
  /**
   * Whether the charts filter on click. OSS: true — they filter the adjacent
   * drift list. EE: false — analytics is its own tab (the list is elsewhere), so
   * the charts are display-only and filtering lives in the Verify tab instead.
   */
  interactive?: boolean;
  /**
   * Wide standalone Analytics tab (vs the narrow Verify aside): lay the kind donut
   * and severity bars side-by-side in one row at ~2× height.
   */
  wide?: boolean;
}

const tooltipClass =
  'pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md border border-border opacity-0 group-hover:opacity-100 transition-opacity z-50';

function Badge({
  icon: Icon,
  iconClass,
  value,
  label,
  tooltip,
}: {
  icon: typeof AlertTriangle;
  iconClass: string;
  value: number;
  label: string;
  tooltip: string;
}) {
  return (
    <div className="group relative flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} />
      <span className="text-xs font-semibold">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={tooltipClass}>{tooltip}</span>
    </div>
  );
}

function breakdowns(drifts: ContractDrift[]) {
  const bySeverity: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const byFile: Record<string, number> = {};
  for (const d of drifts) {
    bySeverity[d.severity] = (bySeverity[d.severity] ?? 0) + 1;
    const k = driftType(d);
    byKind[k] = (byKind[k] ?? 0) + 1;
    if (d.filePath) byFile[d.filePath] = (byFile[d.filePath] ?? 0) + 1;
  }
  return { bySeverity, byKind, byFile };
}

export function VerifyStatsColumn({
  state,
  diff,
  history,
  mode,
  isDiffing,
  filters,
  onToggleSeverity,
  onToggleKind,
  onToggleFile,
  interactive = true,
  wide = false,
}: Props) {
  if (!state) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        No verify run yet.
      </div>
    );
  }

  const diffMode = mode === 'diff';
  const source = diffMode ? diff?.added ?? [] : state.drifts;
  const { bySeverity, byKind, byFile } = breakdowns(source);

  // Layout mirrors analyze's HomePanel aside: a `flex h-full flex-col
  // overflow-hidden` shell with a `flex-1 overflow-y-auto` scroller. The
  // flex-1 child is what reliably bounds the scroll height — putting
  // overflow on the h-full root instead leaves the charts unscrollable.
  const unresolvedCount = state.unresolvedRefs.length;

  // Diff mode but nothing computed yet — mirror analyze's DiffAside pre-compute
  // prompt: a single vertically-centered message, no analytics. Rendered as a
  // direct flex-1 child of the flex-col so it fills + centres (the scrollable
  // analytics body below isn't a flex container, so it can't centre).
  if (diffMode && !diff) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center text-xs text-muted-foreground">
            <GitCompare className="mx-auto mb-2 h-6 w-6 opacity-60" />
            {isDiffing ? (
              'Computing diff…'
            ) : (
              <>
                Click <span className="font-medium text-foreground">Verify</span> to compute the diff
                against the committed baseline.
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
      {unresolvedCount > 0 && (
        <HoverPopover
          align="start"
          width="wide"
          content={`Some artifacts the spec mentions weren't extracted into contracts. Drifts against them won't be detected.`}
        >
          <div className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {unresolvedCount} unresolved reference{unresolvedCount === 1 ? '' : 's'}
            </span>
          </div>
        </HoverPopover>
      )}
        <>
          <div className="flex flex-wrap items-center gap-2">
            {diffMode && diff ? (
              <>
                <Badge icon={PlusCircle} iconClass="text-rose-400" value={diff.summary.added} label="new" tooltip="Drifts introduced by your uncommitted changes" />
                <Badge icon={CheckCircle2} iconClass="text-green-400" value={diff.summary.resolved} label="resolved" tooltip="Baseline drifts your changes have fixed" />
                <Badge icon={Activity} iconClass="text-blue-400" value={diff.summary.unchanged} label="unchanged" tooltip="Baseline drifts your changes haven't touched" />
                <Badge icon={FileText} iconClass="text-blue-400" value={diff.changedFiles.length} label="files" tooltip="Files changed in your working tree" />
              </>
            ) : (
              <>
                <Badge icon={AlertTriangle} iconClass={state.drifts.length > 0 ? 'text-yellow-400' : 'text-muted-foreground'} value={state.drifts.length} label="drifts" tooltip="Drifts detected against the contracts" />
                <Badge icon={Boxes} iconClass="text-muted-foreground" value={state.artifactCount} label="artifacts" tooltip="Artifacts checked from the contracts" />
                <Badge icon={Activity} iconClass="text-blue-400" value={state.extractedOperationCount} label="operations" tooltip="Operations extracted from the code" />
              </>
            )}
          </div>

          {!diffMode && <DriftTrendChart history={history} />}
          {wide ? (
            <div className="grid grid-cols-2 gap-3">
              <DriftKindChart byKind={byKind} activeKind={filters.kind} onKindClick={interactive ? onToggleKind : undefined} tall />
              <SeverityBarChart
                data={{ byCategory: {}, bySeverity, total: source.length }}
                activeSeverity={filters.severity}
                onSeverityClick={interactive ? onToggleSeverity : undefined}
                tall
              />
            </div>
          ) : (
            <>
              <DriftKindChart byKind={byKind} activeKind={filters.kind} onKindClick={interactive ? onToggleKind : undefined} />
              <SeverityBarChart
                data={{ byCategory: {}, bySeverity, total: source.length }}
                activeSeverity={filters.severity}
                onSeverityClick={interactive ? onToggleSeverity : undefined}
              />
            </>
          )}
          <DriftTopFiles byFile={byFile} activeFile={filters.file} onFileClick={interactive ? onToggleFile : undefined} />
        </>
      </div>
    </div>
  );
}
