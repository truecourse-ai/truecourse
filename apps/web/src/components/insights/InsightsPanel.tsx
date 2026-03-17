
import { useCallback, useRef, useState, useMemo } from 'react';
import { AlertTriangle, MessageCircle, Shield, Loader2, AlertCircle } from 'lucide-react';
import { InsightCard } from '@/components/insights/InsightCard';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { SchemaPanel } from '@/components/schema/SchemaPanel';
import { RulesPanel } from '@/components/rules/RulesPanel';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { InsightResponse, DiffCheckResponse } from '@/lib/api';

type InsightsPanelProps = {
  insights: InsightResponse[];
  isLoading: boolean;
  repoId: string;
  selectedService?: string | null;
  selectedServiceName?: string | null;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  explainRequest?: { nodeId: string; nodeName: string; nodeType?: string; nodeContext?: Record<string, unknown> } | null;
  onExplainHandled?: () => void;
  selectedDatabaseId?: string | null;
  isDiffMode?: boolean;
  diffResult?: DiffCheckResponse | null;
  onLocateNode?: (nodeId: string, requiredDepth?: string) => void;
  resolveNodeIdByName?: (name: string, type?: string) => string | null;
};

export function InsightsPanel({
  insights,
  isLoading,
  repoId,
  selectedService,
  selectedServiceName,
  activeTab = 'insights',
  onTabChange,
  explainRequest,
  onExplainHandled,
  selectedDatabaseId,
  isDiffMode,
  diffResult,
  onLocateNode,
  resolveNodeIdByName,
}: InsightsPanelProps) {
  const isChat = activeTab === 'chat';
  const isRules = activeTab === 'rules';

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

  // Build diff insight cards: resolved insights (green badge) + new insights (amber badge)
  const diffInsightCards = useMemo(() => {
    if (!isDiffMode || !diffResult) return null;

    const cards: Array<{ insight: InsightResponse; diffStatus: 'new' | 'resolved' }> = [];

    // New insights — convert DiffInsightItem to InsightResponse shape
    for (const item of diffResult.newInsights) {
      // Resolve node IDs from names for the Locate button
      const targetServiceId = item.targetServiceName && resolveNodeIdByName
        ? resolveNodeIdByName(item.targetServiceName, 'service') : null;
      const targetModuleId = item.targetModuleName && resolveNodeIdByName
        ? resolveNodeIdByName(item.targetModuleName, 'module') : null;
      const targetMethodId = item.targetMethodName && resolveNodeIdByName
        ? resolveNodeIdByName(item.targetMethodName, 'method') : null;

      cards.push({
        insight: {
          id: `new-${cards.length}`,
          type: item.type,
          title: item.title,
          content: item.content,
          severity: item.severity,
          targetServiceId,
          targetServiceName: item.targetServiceName,
          targetModuleId,
          targetModuleName: item.targetModuleName,
          targetMethodId,
          targetMethodName: item.targetMethodName,
          fixPrompt: item.fixPrompt,
          createdAt: new Date().toISOString(),
        },
        diffStatus: 'new',
      });
    }

    // Resolved insights — already full InsightResponse objects from the GET endpoint
    for (const item of (diffResult.resolvedInsights || [])) {
      cards.push({
        insight: item,
        diffStatus: 'resolved',
      });
    }

    // Sort: new first, then resolved; within each group: severity → type → createdAt
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const typeOrder: Record<string, number> = { service: 0, module: 1, function: 2, database: 3 };
    cards.sort((a, b) => {
      const statusDiff = (a.diffStatus === 'new' ? 0 : 1) - (b.diffStatus === 'new' ? 0 : 1);
      if (statusDiff !== 0) return statusDiff;
      const sevDiff = (severityOrder[a.insight.severity] ?? 5) - (severityOrder[b.insight.severity] ?? 5);
      if (sevDiff !== 0) return sevDiff;
      const typeDiff = (typeOrder[a.insight.type] ?? 9) - (typeOrder[b.insight.type] ?? 9);
      if (typeDiff !== 0) return typeDiff;
      return new Date(b.insight.createdAt).getTime() - new Date(a.insight.createdAt).getTime();
    });

    return cards;
  }, [isDiffMode, diffResult, resolveNodeIdByName]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={(v) => onTabChange?.(String(v))} className="flex flex-shrink-0 flex-col">
        <TabsList variant="line" className="w-full">
          <TabsTrigger value="insights">
            <AlertTriangle className="h-4 w-4" />
            Violations
          </TabsTrigger>
          <TabsTrigger value="rules">
            <Shield className="h-4 w-4" />
            Rules
          </TabsTrigger>
          <TabsTrigger value="chat">
            <MessageCircle className="h-4 w-4" />
            Chat
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Insights / Diff content */}
      <div className={`min-h-0 flex-1 flex flex-col overflow-hidden ${isChat || isRules ? 'hidden' : ''}`}>
        <div className="overflow-y-auto p-3 flex-1">
          {isDiffMode && diffInsightCards !== null ? (
            // Diff mode: show InsightCards with new/resolved badges
            <>
              {diffResult?.isStale && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Baseline analysis has changed. Click Analyze to refresh.
                </div>
              )}
              {diffInsightCards.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertTriangle className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No diff results yet. Click Analyze to compare your working tree against the baseline.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {diffInsightCards.map(({ insight, diffStatus }) => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      onLocateNode={onLocateNode}
                      isResolved={diffStatus === 'resolved'}
                      diffStatus={diffStatus}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            // Normal mode: show regular insights
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
              ) : insights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertTriangle className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {selectedService
                      ? 'No violations for this service'
                      : 'No violations yet. Run an analysis to detect violations.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {insights.map((insight) => (
                    <InsightCard key={insight.id} insight={insight} onLocateNode={onLocateNode} />
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
            <SchemaPanel repoId={repoId} databaseId={selectedDatabaseId} insights={insights} />
          </div>
        )}
      </div>

      {/* Chat content — always mounted, hidden when not active */}
      <div className={`min-h-0 flex-1 overflow-hidden ${isChat ? '' : 'hidden'}`}>
        <ChatPanel
          repoId={repoId}
          selectedService={selectedService}
          explainRequest={explainRequest}
          onExplainHandled={onExplainHandled}
        />
      </div>

      {/* Rules content */}
      <div className={`min-h-0 flex-1 overflow-y-auto ${isRules ? '' : 'hidden'}`}>
        <RulesPanel />
      </div>
    </div>
  );
}
