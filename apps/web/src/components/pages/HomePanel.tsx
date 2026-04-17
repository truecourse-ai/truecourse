import { useCallback, useMemo, useRef, useState } from 'react';
import { BarChart3, FileText, GitCompare, Plus, Minus, Shield } from 'lucide-react';
import { TrendChart } from '@/components/analytics/TrendChart';
import { TypePieChart } from '@/components/analytics/TypePieChart';
import { SeverityBarChart } from '@/components/analytics/SeverityBarChart';
import { TopOffendersTable } from '@/components/analytics/TopOffendersTable';
import { ResolutionMetrics } from '@/components/analytics/ResolutionMetrics';
import { CodeHotspots } from '@/components/analytics/CodeHotspots';
import type { BreakdownResponse } from '@/lib/api';
import {
  ViolationsPanel,
  type CategoryFilter,
  type TypeFilter,
} from '@/components/violations/ViolationsPanel';
import { RulesPanel } from '@/components/rules/RulesPanel';
import type { SeverityFilter } from '@/components/ui/SeverityDropdown';
import { Sheet, SheetTrigger, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useAnalytics } from '@/hooks/useAnalytics';
import type { ViolationResponse, DiffCheckResponse } from '@/lib/api';

type HomePanelProps = {
  repoId: string;
  branch?: string;
  analysisId?: string;
  /** Whether this repo has at least one completed analysis. Drives the
   * placeholder-vs-panel decision on first render so there's no flash. */
  hasAnalysis: boolean;
  violations: ViolationResponse[];
  violationsLoading: boolean;
  isDiffMode?: boolean;
  diffResult?: DiffCheckResponse | null;
  onLocateNode: (
    nodeId: string,
    requiredDepth?: string,
    hints?: { serviceId?: string | null; moduleId?: string | null },
  ) => void;
  onOpenFile: (path: string, pinned: boolean, scrollToLine?: number) => void;
};

const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 800;

export function HomePanel({
  repoId,
  branch,
  analysisId,
  hasAnalysis,
  violations,
  violationsLoading,
  isDiffMode,
  diffResult,
  onLocateNode,
  onOpenFile,
}: HomePanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedServiceName, setSelectedServiceName] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const [panelWidth, setPanelWidth] = useState(630);
  const isDragging = useRef(false);

  const handleResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = ev.clientX - startX;
      setPanelWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startW + delta)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  const { trend, breakdown, topOffenders, resolution, codeHotspots } = useAnalytics(
    repoId,
    branch,
    analysisId,
  );

  // Narrow the violations list by the currently-selected offender (service/module/method/database).
  // Code violations carry no node target so they're excluded by an offender selection —
  // code-scoped filtering belongs to the Code Hotspots widget via `selectedPath`.
  const scopedViolations = useMemo(() => {
    if (!selectedService) return violations;
    return violations.filter(
      (v) =>
        v.targetServiceId === selectedService ||
        v.targetModuleId === selectedService ||
        v.targetMethodId === selectedService ||
        v.targetDatabaseId === selectedService,
    );
  }, [violations, selectedService]);

  const clearLocationFilters = useCallback((target?: 'service' | 'path') => {
    if (!target || target === 'service') {
      setSelectedService(null);
      setSelectedServiceName(null);
    }
    if (!target || target === 'path') {
      setSelectedPath(null);
    }
  }, []);

  if (!hasAnalysis) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">No analysis data yet</p>
          <p className="text-xs text-muted-foreground">
            Click <span className="font-medium text-foreground">Analyze</span> above, or run{' '}
            <code className="rounded bg-muted px-1 font-mono">truecourse analyze</code> from the
            project directory. Violations and analytics will appear here once the first analysis
            completes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      <aside
        style={{ width: panelWidth }}
        className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-card"
      >
        {isDiffMode ? (
          <DiffAside
            diffResult={diffResult}
            severityFilter={severityFilter}
            onSeverityClick={(s) =>
              setSeverityFilter(severityFilter === s ? 'all' : (s as SeverityFilter))
            }
            onOpenFile={(p) => onOpenFile(p, true)}
          />
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {resolution && <ResolutionMetrics data={resolution} />}
            {trend && <TrendChart data={trend} />}
            {breakdown && (
              <TypePieChart
                data={breakdown}
                activeCategory={categoryFilter === 'all' ? null : categoryFilter}
                onCategoryClick={(c) =>
                  setCategoryFilter(
                    categoryFilter === c ? 'all' : (c as CategoryFilter),
                  )
                }
              />
            )}
            {breakdown && (
              <SeverityBarChart
                data={breakdown}
                activeSeverity={severityFilter === 'all' ? null : severityFilter}
                onSeverityClick={(s) =>
                  setSeverityFilter(severityFilter === s ? 'all' : (s as SeverityFilter))
                }
              />
            )}
            {topOffenders && (
              <TopOffendersTable
                data={topOffenders}
                activeOffenderId={selectedService}
                onOffenderClick={(o) => {
                  if (selectedService === o.id) {
                    setSelectedService(null);
                    setSelectedServiceName(null);
                  } else {
                    setSelectedService(o.id);
                    setSelectedServiceName(o.name);
                  }
                }}
              />
            )}
            {codeHotspots && (
              <CodeHotspots
                data={codeHotspots}
                activeFilePath={selectedPath}
                onFileClick={(p) => setSelectedPath(selectedPath === p ? null : p)}
              />
            )}
          </div>
        )}
        <div
          className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
          onMouseDown={handleResizeDown}
        />
      </aside>

      <main className="min-w-0 flex-1">
        {isDiffMode && !diffResult ? (
          <div className="flex h-full w-full items-center justify-center p-6">
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <GitCompare className="h-10 w-10 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">No diff yet</p>
              <p className="text-xs text-muted-foreground">
                Click <span className="font-medium text-foreground">Analyze</span> above to
                compare your uncommitted changes against the last full analysis.
              </p>
            </div>
          </div>
        ) : (
        <ViolationsPanel
          headerRight={
            <Sheet>
              <SheetTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    title="Browse Rules"
                    aria-label="Browse Rules"
                  />
                }
              >
                <Shield className="h-3.5 w-3.5" />
              </SheetTrigger>
              <SheetContent
                side="right"
                title="Rules"
                description="Browse the catalog of rules this repo is analyzed against."
              >
                <RulesPanel />
              </SheetContent>
            </Sheet>
          }
          violations={scopedViolations}
          isLoading={violationsLoading}
          repoId={repoId}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          severityFilter={severityFilter}
          onSeverityFilterChange={setSeverityFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          search={search}
          onSearchChange={setSearch}
          selectedService={selectedService}
          selectedServiceName={selectedServiceName}
          selectedPath={selectedPath}
          onClearFilter={clearLocationFilters}
          isDiffMode={isDiffMode}
          diffResult={diffResult}
          onLocateNode={onLocateNode}
          onOpenFile={onOpenFile}
        />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff-mode aside — replaces the lifetime analytics with diff-scoped info.
// Shows new/resolved summary, severity breakdown of new violations, and the
// changed-files list. Hides everything that doesn't answer "what did my
// uncommitted changes do?"
// ---------------------------------------------------------------------------

type DiffAsideProps = {
  diffResult?: DiffCheckResponse | null;
  severityFilter: SeverityFilter;
  onSeverityClick: (severity: string) => void;
  onOpenFile: (path: string) => void;
};

const tooltipClass =
  'pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md border border-border opacity-0 group-hover:opacity-100 transition-opacity z-50';

function DiffAside({
  diffResult,
  severityFilter,
  onSeverityClick,
  onOpenFile,
}: DiffAsideProps) {
  if (!diffResult) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="text-center text-xs text-muted-foreground">
          <GitCompare className="mx-auto mb-2 h-6 w-6 opacity-60" />
          Click <span className="font-medium text-foreground">Analyze</span> to compute a diff.
        </div>
      </div>
    );
  }

  const newCount = diffResult.summary.newCount;
  const resolvedCount = diffResult.summary.resolvedCount;
  const changedFiles = diffResult.changedFiles;

  // Build a BreakdownResponse so we can reuse the same SeverityBarChart widget
  // + colour palette that the normal-mode analytics use.
  const severityCounts: Record<string, number> = {};
  for (const v of diffResult.newViolations) {
    severityCounts[v.severity] = (severityCounts[v.severity] ?? 0) + 1;
  }
  const severityBreakdown: BreakdownResponse = {
    bySeverity: severityCounts,
    byCategory: {},
    total: newCount,
  };

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3">
      {/* Summary pills — same chip pattern as ResolutionMetrics in normal mode */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="group relative flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1">
          <Plus className="h-3.5 w-3.5 shrink-0 text-rose-400" />
          <span className="text-xs font-semibold">{newCount}</span>
          <span className="text-[10px] text-muted-foreground">new</span>
          <span className={tooltipClass}>Violations introduced by your uncommitted changes</span>
        </div>

        <div className="group relative flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1">
          <Minus className="h-3.5 w-3.5 shrink-0 text-green-400" />
          <span className="text-xs font-semibold">{resolvedCount}</span>
          <span className="text-[10px] text-muted-foreground">resolved</span>
          <span className={tooltipClass}>Baseline violations your changes have fixed</span>
        </div>

        <div className="group relative flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1">
          <FileText className="h-3.5 w-3.5 shrink-0 text-blue-400" />
          <span className="text-xs font-semibold">{changedFiles.length}</span>
          <span className="text-[10px] text-muted-foreground">files</span>
          <span className={tooltipClass}>Files changed in your working tree</span>
        </div>
      </div>

      {/* Severity breakdown — reuse the same bar chart as normal mode */}
      {newCount > 0 && (
        <SeverityBarChart
          data={severityBreakdown}
          activeSeverity={severityFilter === 'all' ? null : severityFilter}
          onSeverityClick={onSeverityClick}
        />
      )}

      {/* Changed files list — unchanged visual */}
      {changedFiles.length > 0 && (
        <div className="rounded-md border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Changed files
            </div>
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {changedFiles.length}
            </div>
          </div>
          <ul className="space-y-0.5">
            {changedFiles.map((f) => (
              <li key={`${f.path}::${f.status}`}>
                <button
                  onClick={() => onOpenFile(f.path)}
                  disabled={f.status === 'deleted'}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent`}
                  title={f.status === 'deleted' ? `${f.path} (deleted)` : f.path}
                >
                  <FileStatusBadge status={f.status} />
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-[11px] text-foreground">
                    {f.path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FileStatusBadge({ status }: { status: 'new' | 'modified' | 'deleted' }) {
  const cls =
    status === 'new'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : status === 'deleted'
        ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
        : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  const letter = status === 'new' ? 'A' : status === 'deleted' ? 'D' : 'M';
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-semibold ${cls}`}
      title={status}
    >
      {letter}
    </span>
  );
}
