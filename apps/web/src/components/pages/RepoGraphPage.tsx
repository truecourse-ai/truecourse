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
import type { GraphNode, GraphEdge } from '@/types/graph';

export default function RepoGraphPage() {
  const params = useParams();
  const repoId = Array.isArray(params.slug) ? params.slug[0] : '';
  const [repo, setRepo] = useState<RepoResponse | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | undefined>();
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [filteredNodes, setFilteredNodes] = useState<GraphNode[]>([]);
  const [filteredEdges, setFilteredEdges] = useState<GraphEdge[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState('insights');
  const [explainRequest, setExplainRequest] = useState<{ nodeId: string; nodeName: string } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const { nodes, edges, isLoading: graphLoading, error: graphError, refetch: refetchGraph } =
    useGraph(repoId, selectedBranch);
  const { isConnected, analysisProgress, onEvent } = useSocket(repoId);
  const { insights, isLoading: insightsLoading, refetch: refetchInsights } = useInsights(repoId, selectedService ?? undefined);

  // Fetch repo details
  useEffect(() => {
    if (!repoId) return;
    api.getRepo(repoId).then(setRepo).catch(() => {});
  }, [repoId]);

  // Set default branch
  useEffect(() => {
    if (repo?.defaultBranch && !selectedBranch) {
      setSelectedBranch(repo.defaultBranch);
    }
  }, [repo, selectedBranch]);

  // Initialize filtered data
  useEffect(() => {
    setFilteredNodes(nodes);
    setFilteredEdges(edges);
  }, [nodes, edges]);

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
      refetchInsights();
    });
    return unsub;
  }, [onEvent, refetchInsights]);

  const handleAnalyze = async () => {
    try {
      setIsAnalyzing(true);
      await api.analyzeRepo(repoId, selectedBranch);
    } catch {
      setIsAnalyzing(false);
    }
  };

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedService(nodeId);
  }, []);

  const handleExplainNode = useCallback((nodeId: string) => {
    const nodeName = nodes.find((n) => n.id === nodeId)?.data.label || nodeId;
    setSelectedService(nodeId);
    setActiveTab('chat');
    setExplainRequest({ nodeId, nodeName });
  }, [nodes]);

  const handleFilterChange = useCallback(
    (filters: FilterState) => {
      let filtered = nodes;

      // Exclude service types
      if (filters.excludedTypes.size > 0) {
        filtered = filtered.filter((n) =>
          !filters.excludedTypes.has(n.data.serviceInfo.type),
        );
      }

      // Exclude frameworks
      if (filters.excludedFrameworks.size > 0) {
        filtered = filtered.filter((n) => {
          const fw = n.data.serviceInfo.framework;
          return !fw || !filters.excludedFrameworks.has(fw);
        });
      }

      // Filter by search query
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        filtered = filtered.filter((n) =>
          n.data.label.toLowerCase().includes(query),
        );
      }

      const nodeIds = new Set(filtered.map((n) => n.id));
      const filtEdges = edges.filter(
        (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
      );

      setFilteredNodes(filtered);
      setFilteredEdges(filtEdges);
    },
    [nodes, edges],
  );

  if (!repoId) {
    redirect('/');
  }

  const selectedServiceName = selectedService
    ? nodes.find((n) => n.id === selectedService)?.data.label ?? null
    : null;

  // Extract unique service types and frameworks for filter panel
  const serviceTypes = [...new Set(nodes.map((n) => n.data.serviceInfo.type))];
  const frameworks = [
    ...new Set(
      nodes
        .map((n) => n.data.serviceInfo.framework)
        .filter((f): f is string => !!f),
    ),
  ];

  return (
    <div className="flex h-screen flex-col">
      <Header
        repoName={repo?.name}
        branches={repo?.branches}
        selectedBranch={selectedBranch}
        onBranchChange={setSelectedBranch}
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
                    <ProgressValue className="text-[11px]" />
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
                serviceTypes={serviceTypes}
                frameworks={frameworks}
                onFilterChange={handleFilterChange}
              />
              <GraphCanvas
                initialNodes={filteredNodes}
                initialEdges={filteredEdges}
                onNodeSelect={handleNodeSelect}
                onExplainNode={handleExplainNode}
                selectedNodeId={selectedService}
                repoId={repoId}
                branch={selectedBranch}
                onRefetch={refetchGraph}
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
          />
        </Sidebar>
      </div>
    </div>
  );
}
