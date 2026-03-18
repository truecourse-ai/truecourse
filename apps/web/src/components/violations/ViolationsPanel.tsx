
import { useCallback, useRef, useState, useMemo } from 'react';
import { AlertTriangle, AlertCircle, Loader2 } from 'lucide-react';
import { ViolationCard } from '@/components/violations/ViolationCard';
import { SchemaPanel } from '@/components/schema/SchemaPanel';
import type { ViolationResponse, DiffCheckResponse } from '@/lib/api';

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
  selectedPath?: string | null;
  nodeFilePathMap?: Map<string, string>;
};

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
  selectedPath,
  nodeFilePathMap,
}: ViolationsPanelProps) {
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
    const typeOrder: Record<string, number> = { service: 0, module: 1, function: 2, database: 3 };
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
      const targetId = violation.targetMethodId || violation.targetModuleId || violation.targetServiceId;
      if (!targetId) return true;
      const fp = nodeFilePathMap.get(targetId);
      if (!fp) return true;
      // Bidirectional match: fp contains selectedPath OR selectedPath starts with trailing segments of fp
      if (fp.includes(selectedPath)) return true;
      const parts = fp.split('/');
      for (let i = parts.length - 1; i >= 1; i--) {
        const suffix = parts.slice(i).join('/');
        if (selectedPath.startsWith(suffix + '/') || selectedPath === suffix) return true;
      }
      return false;
    });
  }, [violations, selectedPath, nodeFilePathMap]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
        <div className="overflow-y-auto p-3 flex-1">
          {isDiffMode && diffViolationCards !== null ? (
            <>
              {diffResult?.isStale && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Baseline analysis has changed. Click Analyze to refresh.
                </div>
              )}
              {diffViolationCards.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertTriangle className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No diff results yet. Click Analyze to compare your working tree against the baseline.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {diffViolationCards.map(({ violation, diffStatus }) => (
                    <ViolationCard
                      key={violation.id}
                      violation={violation}
                      onLocateNode={onLocateNode}
                      isResolved={diffStatus === 'resolved'}
                      diffStatus={diffStatus}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {selectedService && (
                <div className="mb-3 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                  Filtered by:{' '}
                  <span className="font-medium text-foreground">
                    {selectedServiceName || selectedService}
                  </span>
                </div>
              )}
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : pathFilteredViolations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertTriangle className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {selectedPath
                      ? 'No violations in this path'
                      : selectedService
                        ? 'No violations for this service'
                        : 'No violations yet. Run an analysis to detect violations.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pathFilteredViolations.map((violation) => (
                    <ViolationCard key={violation.id} violation={violation} onLocateNode={onLocateNode} />
                  ))}
                </div>
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
            <SchemaPanel repoId={repoId} databaseId={selectedDatabaseId} violations={violations} />
          </div>
        )}
      </div>
    </div>
  );
}
