import { useCallback, useMemo, useRef, useState } from 'react';
import { Shield } from 'lucide-react';
import { TrendChart } from '@/components/analytics/TrendChart';
import { TypePieChart } from '@/components/analytics/TypePieChart';
import { SeverityBarChart } from '@/components/analytics/SeverityBarChart';
import { TopOffendersTable } from '@/components/analytics/TopOffendersTable';
import { ResolutionMetrics } from '@/components/analytics/ResolutionMetrics';
import { CodeHotspots } from '@/components/analytics/CodeHotspots';
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

  return (
    <div className="flex h-full w-full">
      <aside
        style={{ width: panelWidth }}
        className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-card"
      >
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
        <div
          className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
          onMouseDown={handleResizeDown}
        />
      </aside>

      <main className="min-w-0 flex-1">
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
      </main>
    </div>
  );
}
