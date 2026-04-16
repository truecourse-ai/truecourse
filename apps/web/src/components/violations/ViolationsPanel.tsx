
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { AlertTriangle, AlertCircle, Loader2, X, Shield, Bug, Network, Zap, HeartPulse, Code2, Database, Paintbrush, Search } from 'lucide-react';
import { ViolationCard } from '@/components/violations/ViolationCard';
import { SchemaPanel } from '@/components/schema/SchemaPanel';
import { SeverityDropdown, type SeverityFilter } from '@/components/ui/SeverityDropdown';
import type { ViolationResponse, DiffCheckResponse } from '@/lib/api';

type CategoryFilter = 'all' | 'security' | 'bugs' | 'architecture' | 'performance' | 'reliability' | 'code-quality' | 'database' | 'style';
type TypeFilter = 'all' | 'deterministic' | 'llm';
type ViolationsPanelProps = {
  violations: ViolationResponse[];
  isLoading: boolean;
  repoId: string;
  selectedService?: string | null;
  selectedServiceName?: string | null;
  selectedDatabaseId?: string | null;
  isDiffMode?: boolean;
  diffResult?: DiffCheckResponse | null;
  onLocateNode?: (nodeId: string, requiredDepth?: string) => void;
  onOpenFile?: (path: string, pinned: boolean, scrollToLine?: number) => void;
  onClearFilter?: () => void;
  selectedPath?: string | null;
  nodeFilePathMap?: Map<string, string>;
  onOpenDatabaseInTab?: (dbId: string, dbName: string) => void;
};

const categories: { value: CategoryFilter; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All', icon: <Shield className="h-3.5 w-3.5" /> },
  { value: 'security', label: 'Security', icon: <Shield className="h-3.5 w-3.5" /> },
  { value: 'bugs', label: 'Bugs', icon: <Bug className="h-3.5 w-3.5" /> },
  { value: 'architecture', label: 'Architecture', icon: <Network className="h-3.5 w-3.5" /> },
  { value: 'performance', label: 'Performance', icon: <Zap className="h-3.5 w-3.5" /> },
  { value: 'reliability', label: 'Reliability', icon: <HeartPulse className="h-3.5 w-3.5" /> },
  { value: 'code-quality', label: 'Code Quality', icon: <Code2 className="h-3.5 w-3.5" /> },
  { value: 'database', label: 'Database', icon: <Database className="h-3.5 w-3.5" /> },
  { value: 'style', label: 'Style', icon: <Paintbrush className="h-3.5 w-3.5" /> },
];

/** Derive domain from ruleKey (e.g. 'security/deterministic/foo' → 'security') */
function getDomain(v: ViolationResponse): string {
  const key = v.ruleKey || '';
  const slash = key.indexOf('/');
  return slash > 0 ? key.slice(0, slash) : v.type;
}

/** Derive detection type from ruleKey (e.g. 'security/deterministic/foo' → 'deterministic') */
function getDetectionType(v: ViolationResponse): 'deterministic' | 'llm' {
  const key = v.ruleKey || '';
  return key.includes('/llm/') ? 'llm' : 'deterministic';
}

function matchesSearch(violation: ViolationResponse, search: string): boolean {
  const q = search.toLowerCase();
  return (
    violation.title.toLowerCase().includes(q) ||
    violation.content?.toLowerCase().includes(q) ||
    violation.targetServiceName?.toLowerCase().includes(q) ||
    violation.targetModuleName?.toLowerCase().includes(q) ||
    violation.targetMethodName?.toLowerCase().includes(q) ||
    false
  );
}

export function ViolationsPanel({
  violations,
  isLoading,
  repoId,
  selectedService,
  selectedServiceName,
  selectedDatabaseId,
  isDiffMode,
  diffResult,
  onLocateNode,
  onOpenFile,
  onClearFilter,
  selectedPath,
  nodeFilePathMap,
  onOpenDatabaseInTab,
}: ViolationsPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');

  const normalListRef = useRef<VirtuosoHandle>(null);
  const diffListRef = useRef<VirtuosoHandle>(null);

  // Reset scroll to top whenever the active filter set changes — otherwise the
  // user is left at an offset that no longer maps to meaningful content.
  useEffect(() => {
    normalListRef.current?.scrollTo({ top: 0 });
    diffListRef.current?.scrollTo({ top: 0 });
  }, [categoryFilter, severityFilter, typeFilter, search, selectedPath, isDiffMode]);

  // Resizable ER panel
  const [erHeight, setErHeight] = useState(264);
  const isDraggingEr = useRef(false);

  const handleErResizeDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingEr.current = true;
      const startY = e.clientY;
      const startH = erHeight;

      const onMove = (ev: MouseEvent) => {
        if (!isDraggingEr.current) return;
        const delta = startY - ev.clientY;
        setErHeight(Math.min(500, Math.max(120, startH + delta)));
      };

      const onUp = () => {
        isDraggingEr.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [erHeight],
  );

  // Build diff violation cards
  const diffViolationCards = useMemo(() => {
    if (!isDiffMode || !diffResult) return null;

    const cards: Array<{ violation: ViolationResponse; diffStatus: 'new' | 'resolved' }> = [];

    for (const item of diffResult.newViolations) {
      cards.push({
        violation: {
          id: `new-${cards.length}`,
          type: item.type,
          title: item.title,
          content: item.content,
          severity: item.severity,
          targetServiceId: item.targetServiceId ?? null,
          targetServiceName: item.targetServiceName,
          targetModuleId: item.targetModuleId ?? null,
          targetModuleName: item.targetModuleName,
          targetMethodId: item.targetMethodId ?? null,
          targetMethodName: item.targetMethodName,
          fixPrompt: item.fixPrompt,
          filePath: item.filePath,
          lineStart: item.lineStart,
          createdAt: new Date().toISOString(),
        },
        diffStatus: 'new',
      });
    }

    for (const item of (diffResult.resolvedViolations || [])) {
      cards.push({
        violation: item,
        diffStatus: 'resolved',
      });
    }

    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const typeOrder: Record<string, number> = { service: 0, module: 1, function: 2, database: 3, code: 4 };
    cards.sort((a, b) => {
      const statusDiff = (a.diffStatus === 'new' ? 0 : 1) - (b.diffStatus === 'new' ? 0 : 1);
      if (statusDiff !== 0) return statusDiff;
      const sevDiff = (severityOrder[a.violation.severity] ?? 5) - (severityOrder[b.violation.severity] ?? 5);
      if (sevDiff !== 0) return sevDiff;
      const typeDiff = (typeOrder[a.violation.type] ?? 9) - (typeOrder[b.violation.type] ?? 9);
      if (typeDiff !== 0) return typeDiff;
      return new Date(b.violation.createdAt).getTime() - new Date(a.violation.createdAt).getTime();
    });

    return cards;
  }, [isDiffMode, diffResult]);

  // Filter violations by selected file path
  const pathFilteredViolations = useMemo(() => {
    if (!selectedPath || !nodeFilePathMap) return violations;
    return violations.filter((violation) => {
      // Code violations: match by filePath directly
      if (violation.type === 'code' && violation.filePath) {
        if (violation.filePath.includes(selectedPath)) return true;
        if (selectedPath.includes(violation.filePath)) return true;
        const parts = violation.filePath.split('/');
        for (let i = parts.length - 1; i >= 1; i--) {
          const suffix = parts.slice(i).join('/');
          if (selectedPath.startsWith(suffix + '/') || selectedPath === suffix) return true;
        }
        return false;
      }

      const targetId = violation.targetMethodId || violation.targetModuleId || violation.targetServiceId;
      if (!targetId) return true;
      const fp = nodeFilePathMap.get(targetId);
      if (!fp) return true;
      if (fp.includes(selectedPath)) return true;
      const parts = fp.split('/');
      for (let i = parts.length - 1; i >= 1; i--) {
        const suffix = parts.slice(i).join('/');
        if (selectedPath.startsWith(suffix + '/') || selectedPath === suffix) return true;
      }
      return false;
    });
  }, [violations, selectedPath, nodeFilePathMap]);

  // Pre-category filtered: applies search + severity + type but not category
  const preCategoryFiltered = useMemo(() => {
    let result = pathFilteredViolations;
    if (severityFilter !== 'all') result = result.filter((v) => v.severity === severityFilter);
    if (typeFilter !== 'all') result = result.filter((v) => getDetectionType(v) === typeFilter);
    if (search) result = result.filter((v) => matchesSearch(v, search));
    return result;
  }, [pathFilteredViolations, severityFilter, typeFilter, search]);

  // Apply category filter on top
  const fullyFilteredViolations = useMemo(() => {
    if (categoryFilter === 'all') return preCategoryFiltered;
    return preCategoryFiltered.filter((v) => getDomain(v) === categoryFilter);
  }, [preCategoryFiltered, categoryFilter]);

  // Category counts reflect search + severity filters
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of preCategoryFiltered) {
      counts[getDomain(v)] = (counts[getDomain(v)] || 0) + 1;
    }
    return counts;
  }, [preCategoryFiltered]);

  // Severity counts reflect search + path filters (not severity filter itself)
  const severityCounts = useMemo(() => {
    let result = pathFilteredViolations;
    if (search) result = result.filter((v) => matchesSearch(v, search));
    const counts: Record<string, number> = {};
    for (const v of result) {
      counts[v.severity] = (counts[v.severity] || 0) + 1;
    }
    return counts;
  }, [pathFilteredViolations, search]);

  // Diff mode: pre-category filtered
  const preCategoryDiffCards = useMemo(() => {
    if (!diffViolationCards) return null;
    let result = diffViolationCards;
    if (severityFilter !== 'all') result = result.filter((c) => c.violation.severity === severityFilter);
    if (search) result = result.filter((c) => matchesSearch(c.violation, search));
    return result;
  }, [diffViolationCards, severityFilter, search]);

  const filteredDiffCards = useMemo(() => {
    if (!preCategoryDiffCards) return null;
    if (categoryFilter === 'all') return preCategoryDiffCards;
    return preCategoryDiffCards.filter((c) => getDomain(c.violation) === categoryFilter);
  }, [preCategoryDiffCards, categoryFilter]);

  const diffCategoryCounts = useMemo(() => {
    if (!preCategoryDiffCards) return {};
    const counts: Record<string, number> = {};
    for (const c of preCategoryDiffCards) {
      counts[getDomain(c.violation)] = (counts[getDomain(c.violation)] || 0) + 1;
    }
    return counts;
  }, [preCategoryDiffCards]);

  const diffSeverityCounts = useMemo(() => {
    if (!diffViolationCards) return {};
    let result = diffViolationCards;
    if (search) result = result.filter((c) => matchesSearch(c.violation, search));
    const counts: Record<string, number> = {};
    for (const c of result) {
      counts[c.violation.severity] = (counts[c.violation.severity] || 0) + 1;
    }
    return counts;
  }, [diffViolationCards, search]);

  const activeSeverityCounts = isDiffMode ? diffSeverityCounts : severityCounts;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
        {/* Search + severity filter */}
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search violations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary/50"
              />
            </div>
            <SeverityDropdown value={severityFilter} onChange={setSeverityFilter} counts={activeSeverityCounts} />
            <div className="flex rounded-md border border-border">
              {(['all', 'deterministic', 'llm'] as TypeFilter[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-2 py-1 text-[10px] font-medium first:rounded-l-md last:rounded-r-md ${
                    typeFilter === t
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t === 'all' ? 'All' : t === 'deterministic' ? 'Det' : 'LLM'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Category tabs */}
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="flex gap-1 overflow-x-auto scrollbar-thin">
            {categories.map((cat) => {
              const counts = isDiffMode ? diffCategoryCounts : categoryCounts;
              const total = isDiffMode ? (preCategoryDiffCards?.length || 0) : preCategoryFiltered.length;
              const count = cat.value === 'all' ? total : counts[cat.value] || 0;
              return (
                <button
                  key={cat.value}
                  onClick={() => setCategoryFilter(cat.value)}
                  className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    categoryFilter === cat.value
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {cat.icon}
                  {cat.label}
                  {count > 0 && (
                    <span className="ml-0.5 text-[10px] opacity-70">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {isDiffMode && filteredDiffCards !== null ? (
            <>
              {diffResult?.isStale && (
                <div className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Baseline analysis has changed. Click Analyze to refresh.
                </div>
              )}

              {filteredDiffCards.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertTriangle className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {diffViolationCards && diffViolationCards.length > 0
                      ? `No ${categoryFilter} violations in diff results`
                      : 'No diff results yet. Click Analyze to compare your working tree against the baseline.'}
                  </p>
                </div>
              ) : (
                <Virtuoso
                  ref={diffListRef}
                  data={filteredDiffCards}
                  computeItemKey={(_, item) => item.violation.id}
                  initialTopMostItemIndex={0}
                  increaseViewportBy={400}
                  components={{
                    Header: () => <div className="h-3" />,
                    Footer: () => <div className="h-3" />,
                  }}
                  itemContent={(_, { violation, diffStatus }) => (
                    <div className="px-3 pb-3">
                      <ViolationCard
                        violation={violation}
                        onLocateNode={onLocateNode}
                        onOpenFile={onOpenFile}
                        isResolved={diffStatus === 'resolved'}
                        diffStatus={diffStatus}
                      />
                    </div>
                  )}
                />
              )}
            </>
          ) : (
            <>
              {selectedService && (
                <div className="mx-3 mt-3 flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="truncate flex-1">
                    Filtered by:{' '}
                    <span className="font-medium text-foreground">
                      {selectedServiceName || selectedService}
                    </span>
                  </span>
                  {onClearFilter && (
                    <button
                      onClick={onClearFilter}
                      className="shrink-0 rounded p-0.5 hover:bg-background/50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : fullyFilteredViolations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertTriangle className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {search
                      ? 'No violations match your search'
                      : selectedPath
                        ? 'No violations in this path'
                        : selectedService
                          ? 'No violations for this service'
                          : categoryFilter !== 'all' || severityFilter !== 'all'
                            ? 'No violations match the selected filters'
                            : 'No violations yet. Run an analysis to detect violations.'}
                  </p>
                </div>
              ) : (
                <Virtuoso
                  ref={normalListRef}
                  data={fullyFilteredViolations}
                  computeItemKey={(_, item) => item.id}
                  initialTopMostItemIndex={0}
                  increaseViewportBy={400}
                  components={{
                    Header: () => <div className="h-3" />,
                    Footer: () => <div className="h-3" />,
                  }}
                  itemContent={(_, violation) => (
                    <div className="px-3 pb-3">
                      <ViolationCard
                        violation={violation}
                        onLocateNode={onLocateNode}
                        onOpenFile={onOpenFile}
                      />
                    </div>
                  )}
                />
              )}
            </>
          )}
        </div>

        {/* ER diagram with resize handle */}
        {selectedDatabaseId && !isDiffMode && (
          <div className="relative flex-shrink-0 border-t border-border" style={{ height: erHeight }}>
            <div
              className="absolute inset-x-0 top-0 z-10 h-1 cursor-row-resize hover:bg-primary/30 active:bg-primary/50"
              onMouseDown={handleErResizeDown}
            />
            <SchemaPanel repoId={repoId} databaseId={selectedDatabaseId} violations={violations} onOpenInTab={onOpenDatabaseInTab} />
          </div>
        )}
      </div>
    </div>
  );
}
