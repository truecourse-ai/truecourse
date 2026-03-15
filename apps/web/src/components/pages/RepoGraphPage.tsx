'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, redirect } from 'next/navigation';
import { Loader2, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { GraphCanvas } from '@/components/graph/GraphCanvas';
import { InsightsPanel } from '@/components/insights/InsightsPanel';
import { FilterPanel, type FilterState } from '@/components/graph/controls/FilterPanel';
import { useGraph } from '@/hooks/useGraph';
import { useSocket } from '@/hooks/useSocket';
import { useInsights } from '@/hooks/useInsights';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import * as api from '@/lib/api';
import type { RepoResponse } from '@/lib/api';
import type { GraphNode, GraphEdge, DepthLevel } from '@/types/graph';
import type { Node, Edge } from '@xyflow/react';

export default function RepoGraphPage() {
  const params = useParams();
  const repoId = Array.isArray(params.slug) ? params.slug[0] : '';
  const [repo, setRepo] = useState<RepoResponse | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [depthLevel, setDepthLevel] = useState<DepthLevel>('services');
  const [filteredNodes, setFilteredNodes] = useState<Node[]>([]);
  const [filteredEdges, setFilteredEdges] = useState<Edge[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState('insights');
  const [explainRequest, setExplainRequest] = useState<{ nodeId: string; nodeName: string; nodeType?: string } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; key: number } | null>(null);

  const currentBranch = repo?.defaultBranch;
  const { nodes, edges, isLoading: graphLoading, error: graphError, refetch: refetchGraph } =
    useGraph(repoId, currentBranch, depthLevel);
  const { isConnected, analysisProgress, onEvent } = useSocket(repoId);
  const { insights, isLoading: insightsLoading, refetch: refetchInsights } = useInsights(repoId, selectedService ?? undefined);

  // Fetch repo details
  useEffect(() => {
    if (!repoId) return;
    api.getRepo(repoId).then(setRepo).catch(() => {});
  }, [repoId]);

  // Initialize filtered data
  useEffect(() => {
    setFilteredNodes(nodes);
    setFilteredEdges(edges);
  }, [nodes, edges]);

  // Sync isAnalyzing with server-side progress (handles page refresh mid-analysis)
  useEffect(() => {
    if (analysisProgress && !isAnalyzing) {
      setIsAnalyzing(true);
    }
  }, [analysisProgress, isAnalyzing]);

  // Listen for analysis complete to refetch
  useEffect(() => {
    const unsub = onEvent('analysis:complete', () => {
      setIsAnalyzing(false);
      refetchGraph();
    });
    return unsub;
  }, [onEvent, refetchGraph]);

  // Listen for insights ready
  useEffect(() => {
    const unsub = onEvent('insights:ready', () => {
      setIsAnalyzing(false);
      refetchInsights();
    });
    return unsub;
  }, [onEvent, refetchInsights]);

  const handleAnalyze = async () => {
    try {
      setIsAnalyzing(true);
      await api.analyzeRepo(repoId);
    } catch {
      setIsAnalyzing(false);
    }
  };

  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedService(nodeId);

    // Check if clicked node is a database node
    if (nodeId) {
      const clickedNode = nodes.find((n) => n.id === nodeId);
      if (clickedNode && clickedNode.type === 'database') {
        setSelectedDatabaseId(nodeId);
        setActiveTab('insights');
        return;
      }
    }
    setSelectedDatabaseId(null);
  }, [nodes]);

  const handleExplainNode = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    const nodeName = (node?.data as Record<string, unknown>)?.label as string || nodeId;
    setSelectedService(nodeId);
    setActiveTab('chat');
    setExplainRequest({ nodeId, nodeName, nodeType: node?.type });
  }, [nodes]);

  const handleFilterChange = useCallback(
    (filters: FilterState) => {
      const hiddenIds = new Set<string>();

      if (depthLevel === 'services') {
        for (const n of nodes) {
          const d = n.data as Record<string, unknown>;
          const info = d.serviceInfo as { type: string; framework: string | null } | undefined;
          if (info && filters.excludedTypes.size > 0 && filters.excludedTypes.has(info.type)) {
            hiddenIds.add(n.id);
          }
          if (info?.framework && filters.excludedFrameworks.size > 0 && filters.excludedFrameworks.has(info.framework)) {
            hiddenIds.add(n.id);
          }
          if (filters.searchQuery) {
            const label = (d.label as string) || '';
            if (!label.toLowerCase().includes(filters.searchQuery.toLowerCase())) {
              hiddenIds.add(n.id);
            }
          }
          if (!filters.showDatabases && n.type === 'database') {
            hiddenIds.add(n.id);
          }
        }
      } else {
        // Hierarchical modes: serviceGroup > layer > module > method
        const parentMap = new Map<string, string>();
        for (const n of nodes) {
          const pid = (n as Record<string, unknown>).parentId as string | undefined;
          if (pid) parentMap.set(n.id, pid);
        }

        // Hide databases
        if (!filters.showDatabases) {
          for (const n of nodes) {
            if (n.type === 'database') hiddenIds.add(n.id);
          }
        }

        // Hide service groups by type/framework
        for (const n of nodes) {
          if (n.type !== 'serviceGroup') continue;
          const d = n.data as Record<string, unknown>;
          if (filters.excludedTypes.size > 0 && filters.excludedTypes.has(d.serviceType as string)) {
            hiddenIds.add(n.id);
          }
          if (d.framework && filters.excludedFrameworks.size > 0 && filters.excludedFrameworks.has(d.framework as string)) {
            hiddenIds.add(n.id);
          }
        }

        // Hide layers by layer type
        if (filters.excludedLayers.size > 0) {
          for (const n of nodes) {
            if (n.type !== 'layer') continue;
            const d = n.data as Record<string, unknown>;
            if (filters.excludedLayers.has(d.label as string)) {
              hiddenIds.add(n.id);
            }
          }
        }

        // Cascade: hide children of hidden parents
        let changed = true;
        while (changed) {
          changed = false;
          for (const n of nodes) {
            if (hiddenIds.has(n.id)) continue;
            const pid = parentMap.get(n.id);
            if (pid && hiddenIds.has(pid)) {
              hiddenIds.add(n.id);
              changed = true;
            }
          }
        }

        // Search: match labels, keep matching nodes + ancestors + descendants
        if (filters.searchQuery) {
          const query = filters.searchQuery.toLowerCase();
          const matchingIds = new Set<string>();

          for (const n of nodes) {
            if (hiddenIds.has(n.id)) continue;
            const label = ((n.data as Record<string, unknown>).label as string) || '';
            if (label.toLowerCase().includes(query)) {
              matchingIds.add(n.id);
              let pid = parentMap.get(n.id);
              while (pid) { matchingIds.add(pid); pid = parentMap.get(pid); }
            }
          }

          // Keep all children of matching nodes visible
          let expandChanged = true;
          while (expandChanged) {
            expandChanged = false;
            for (const n of nodes) {
              if (matchingIds.has(n.id)) continue;
              const pid = parentMap.get(n.id);
              if (pid && matchingIds.has(pid)) {
                matchingIds.add(n.id);
                expandChanged = true;
              }
            }
          }

          for (const n of nodes) {
            if (n.type === 'database') continue;
            if (!matchingIds.has(n.id)) hiddenIds.add(n.id);
          }
        }

        // Remove empty service groups
        for (const n of nodes) {
          if (n.type !== 'serviceGroup' || hiddenIds.has(n.id)) continue;
          const hasChild = nodes.some((c) => parentMap.get(c.id) === n.id && !hiddenIds.has(c.id));
          if (!hasChild) hiddenIds.add(n.id);
        }
      }

      const visible = nodes.filter((n) => !hiddenIds.has(n.id));
      const visibleIds = new Set(visible.map((n) => n.id));
      const visibleEdges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

      setFilteredNodes(visible);
      setFilteredEdges(visibleEdges);
    },
    [nodes, edges, depthLevel],
  );

  if (!repoId) {
    redirect('/');
  }

  const selectedServiceName = selectedService
    ? ((nodes.find((n) => n.id === selectedService)?.data as Record<string, unknown>)?.label as string) ?? null
    : null;

  // Extract filter options from nodes
  const hasDatabases = nodes.some((n) => n.type === 'database');
  const typeSet = new Set<string>();
  const fwSet = new Set<string>();
  const layerSet = new Set<string>();

  for (const n of nodes) {
    const d = n.data as Record<string, unknown>;
    if (n.type === 'service') {
      const info = d.serviceInfo as { type: string; framework: string | null } | undefined;
      if (info?.type) typeSet.add(info.type);
      if (info?.framework) fwSet.add(info.framework);
    }
    if (n.type === 'serviceGroup') {
      if (d.serviceType) typeSet.add(d.serviceType as string);
      if (d.framework) fwSet.add(d.framework as string);
    }
    if (n.type === 'layer') {
      layerSet.add(d.label as string);
    }
  }

  const serviceTypes = [...typeSet];
  const frameworks = [...fwSet];
  const layerTypes = [...layerSet];

  return (
    <div className="flex h-screen flex-col">
      <Header
        repoName={repo?.name}
        currentBranch={currentBranch}
        onAnalyze={handleAnalyze}
        isAnalyzing={isAnalyzing}
        showBack
        backHref="/"
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Graph area */}
        <div className="relative flex-1">
          {/* Analysis progress */}
          {analysisProgress && (
            <div className="absolute bottom-4 left-1/2 z-20 w-72 -translate-x-1/2 rounded-lg border border-border bg-card p-3 shadow-lg">
              <div className="flex items-center gap-2.5">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <Progress value={analysisProgress.percent} className="flex-1 gap-1">
                  <div className="flex w-full items-center justify-between">
                    <ProgressLabel className="text-[11px] font-medium capitalize">
                      {analysisProgress.step}
                    </ProgressLabel>
                    {/* <ProgressValue className="text-[11px]" /> */}
                  </div>
                </Progress>
              </div>
              {analysisProgress.detail && (
                <p className="mt-1.5 pl-6 text-[10px] text-muted-foreground">
                  {analysisProgress.detail}
                </p>
              )}
            </div>
          )}

          {/* Connection status */}
          <div className="absolute right-3 top-2 z-20 flex items-center gap-1.5 rounded-full bg-card px-2 py-1 text-[10px] shadow-sm border border-border">
            {isConnected ? (
              <>
                <Wifi className="h-3 w-3 text-emerald-500" />
                <span className="text-emerald-500">Live</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Offline</span>
              </>
            )}
          </div>

          {graphLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading graph...</p>
              </div>
            </div>
          ) : graphError ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <Alert variant="destructive" className="max-w-sm">
                  <AlertTitle>Failed to load graph</AlertTitle>
                  <AlertDescription>{graphError}</AlertDescription>
                </Alert>
                <Button
                  onClick={() => refetchGraph()}
                  className="mt-2"
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : filteredNodes.length === 0 && nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertCircle className="h-10 w-10 text-muted-foreground" />
                <Alert className="max-w-sm">
                  <AlertTitle>No graph data</AlertTitle>
                  <AlertDescription>
                    Run an analysis to generate the architecture graph
                  </AlertDescription>
                </Alert>
                <Button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  className="mt-2"
                >
                  {isAnalyzing && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isAnalyzing ? 'Analyzing...' : 'Analyze Repository'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <FilterPanel
                depthLevel={depthLevel}
                serviceTypes={serviceTypes}
                frameworks={frameworks}
                layerTypes={layerTypes}
                hasDatabases={hasDatabases}
                onFilterChange={handleFilterChange}
              />
              <GraphCanvas
                initialNodes={filteredNodes}
                initialEdges={filteredEdges}
                onNodeSelect={handleNodeSelect}
                onExplainNode={handleExplainNode}
                selectedNodeId={selectedService}
                repoId={repoId}
                branch={currentBranch}
                onRefetch={refetchGraph}
                depthLevel={depthLevel}
                onDepthChange={setDepthLevel}
                focusNodeId={focusRequest?.nodeId ?? null}
                focusKey={focusRequest?.key ?? 0}
              />
            </>
          )}
        </div>

        {/* Sidebar */}
        <Sidebar isOpen={isSidebarOpen}>
          <InsightsPanel
            insights={insights}
            isLoading={insightsLoading}
            repoId={repoId}
            selectedService={selectedService}
            selectedServiceName={selectedServiceName}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            explainRequest={explainRequest}
            onExplainHandled={() => setExplainRequest(null)}
            selectedDatabaseId={selectedDatabaseId}
            onLocateNode={(nodeId, requiredDepth) => {
              if (requiredDepth && requiredDepth !== depthLevel) {
                setDepthLevel(requiredDepth as DepthLevel);
                setTimeout(() => setFocusRequest({ nodeId, key: Date.now() }), 500);
              } else {
                setFocusRequest({ nodeId, key: Date.now() });
              }
            }}
          />
        </Sidebar>
      </div>
    </div>
  );
}
