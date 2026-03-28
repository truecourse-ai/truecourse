
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import { Loader2, AlertCircle, Wifi, WifiOff, X, Workflow, Database, Check, CircleX } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { LeftSidebar, type LeftTab } from '@/components/layout/LeftSidebar';
import { GraphCanvas } from '@/components/graph/GraphCanvas';
import { ViolationsPanel } from '@/components/violations/ViolationsPanel';
import { RulesPanel } from '@/components/rules/RulesPanel';
import { FileTree } from '@/components/files/FileTree';
import { FlowList } from '@/components/flows/FlowList';
import { FlowDiagramPanel } from '@/components/flows/FlowDiagramPanel';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { CodeViewerPanel } from '@/components/code/CodeViewerPanel';
import { SchemaPanel } from '@/components/schema/SchemaPanel';
import { DatabaseList } from '@/components/schema/DatabaseList';
import { AnalyticsDashboard } from '@/components/analytics/AnalyticsDashboard';
import { AnalysesPanel } from '@/components/analyses/AnalysesPanel';
import { FilterPanel, type FilterState } from '@/components/graph/controls/FilterPanel';
import { useGraph } from '@/hooks/useGraph';
import { useSocket } from '@/hooks/useSocket';
import { useViolations } from '@/hooks/useViolations';
import { useDiffCheck } from '@/hooks/useDiffCheck';
import { useAnalysisList } from '@/hooks/useAnalysisList';
import { useCodeViolationSummary } from '@/hooks/useCodeViolationSummary';
import { useFlows } from '@/hooks/useFlows';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import * as api from '@/lib/api';
import type { RepoResponse } from '@/lib/api';
import type { DepthLevel } from '@/types/graph';
import type { Node, Edge } from '@xyflow/react';

type OpenFile = {
  path: string;
  pinned: boolean;
  scrollToLine?: number;
};

type OpenFlow = {
  id: string;
  name: string;
  pinned: boolean;
};

type OpenDatabase = {
  id: string;
  name: string;
  pinned: boolean;
};

const VALID_LEFT_TABS = new Set<LeftTab>([
  'violations',
  'rules',
  'files',
  'flows',
  'databases',
  'analytics',
  'analyses',
]);

const MAIN_CONTENT_TABS = new Set<LeftTab>([
  'violations',
  'rules',
  'analytics',
  'analyses',
]);

export default function RepoGraphPage() {
  const { repoId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [repo, setRepo] = useState<RepoResponse | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);

  // Map URL terms (functions) ↔ internal terms (methods)
  const urlToDepth: Record<string, DepthLevel> = { services: 'services', modules: 'modules', functions: 'methods' };
  const depthToUrl: Record<DepthLevel, string> = { services: 'services', modules: 'modules', methods: 'functions' };
  const modeFromUrl = searchParams?.get('mode') || '';
  const initialMode = urlToDepth[modeFromUrl] || 'services';
  const [depthLevel, setDepthLevelState] = useState<DepthLevel>(initialMode);

  const setDepthLevel = useCallback((level: DepthLevel) => {
    setDepthLevelState(level);
    const url = new URL(window.location.href);
    if (level === 'services') {
      url.searchParams.delete('mode');
    } else {
      url.searchParams.set('mode', depthToUrl[level]);
    }
    navigate(url.pathname + url.search, { replace: true });
  }, [navigate]);
  const [filteredNodes, setFilteredNodes] = useState<Node[]>([]);
  const [filteredEdges, setFilteredEdges] = useState<Edge[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCodeReviewing, setIsCodeReviewing] = useState(false);
  const [explainRequest, setExplainRequest] = useState<{ nodeId: string; nodeName: string; nodeType?: string; nodeContext?: Record<string, unknown> } | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [leftTab, setLeftTabState] = useState<LeftTab | null>(() => {
    const tabParam = searchParams?.get('tab');
    if (tabParam && VALID_LEFT_TABS.has(tabParam as LeftTab)) {
      return tabParam as LeftTab;
    }
    if (searchParams?.get('flow')) return 'flows';
    if (searchParams?.get('file')) return 'files';
    return 'violations';
  });
  const setLeftTab = useCallback((tab: LeftTab | null) => {
    setLeftTabState(tab);
    const url = new URL(window.location.href);
    if (tab && tab !== 'violations') {
      url.searchParams.set('tab', tab);
    } else {
      url.searchParams.delete('tab');
    }
    window.history.replaceState({}, '', url.toString());
  }, []);
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; key: number } | null>(null);
  const [isDiffMode, setIsDiffModeState] = useState(searchParams?.get('view') === 'diff');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);

  // Multi-tab file viewer state — restore from URL
  const fileFromUrl = searchParams?.get('file') || null;
  const [openFiles, setOpenFiles] = useState<OpenFile[]>(() =>
    fileFromUrl ? [{ path: fileFromUrl, pinned: true }] : []
  );
  const [activeFilePath, setActiveFilePathState] = useState<string | null>(fileFromUrl);

  const setActiveFilePath = useCallback((path: string | null) => {
    setActiveFilePathState(path);
    const url = new URL(window.location.href);
    if (path) {
      url.searchParams.set('file', path);
    } else {
      url.searchParams.delete('file');
    }
    navigate(url.pathname + url.search, { replace: true });
  }, [navigate]);

  const handleOpenFile = useCallback((path: string, pinned: boolean, scrollToLine?: number) => {
    setOpenFiles((prev) => {
      const existing = prev.find((f) => f.path === path);
      if (existing) {
        return prev.map((f) => f.path === path
          ? { ...f, pinned: pinned || f.pinned, scrollToLine: scrollToLine ?? f.scrollToLine }
          : f);
      }

      if (pinned) {
        return [...prev, { path, pinned: true, scrollToLine }];
      }

      const hasUnpinned = prev.find((f) => !f.pinned);
      if (hasUnpinned) {
        return prev.map((f) => !f.pinned ? { path, pinned: false, scrollToLine } : f);
      }
      return [...prev, { path, pinned: false, scrollToLine }];
    });
    setActiveFilePath(path);
    setLeftTab('files');
  }, []);

  const handleCloseFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== path);
      return next;
    });
    if (activeFilePath === path) {
      const remaining = openFiles.filter((f) => f.path !== path);
      setActiveFilePath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
  }, [openFiles, activeFilePath, setActiveFilePath]);

  // Multi-tab flow viewer state — restore from URL
  const flowFromUrl = searchParams?.get('flow') || null;
  const [openFlows, setOpenFlows] = useState<OpenFlow[]>(() =>
    flowFromUrl ? [{ id: flowFromUrl, name: 'Flow', pinned: true }] : []
  );
  const [activeFlowId, setActiveFlowIdState] = useState<string | null>(flowFromUrl);

  const setActiveFlowId = useCallback((id: string | null) => {
    setActiveFlowIdState(id);
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set('flow', id);
      url.searchParams.delete('file');
    } else {
      url.searchParams.delete('flow');
    }
    navigate(url.pathname + url.search, { replace: true });
  }, [navigate]);

  const handleCloseFlow = useCallback((flowId: string) => {
    setOpenFlows((prev) => prev.filter((f) => f.id !== flowId));
    if (activeFlowId === flowId) {
      const remaining = openFlows.filter((f) => f.id !== flowId);
      setActiveFlowId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  }, [openFlows, activeFlowId, setActiveFlowId]);

  // Multi-tab database viewer state
  const [openDatabases, setOpenDatabases] = useState<OpenDatabase[]>([]);
  const [activeDbId, setActiveDbIdState] = useState<string | null>(null);

  const setActiveDbId = useCallback((id: string | null) => {
    setActiveDbIdState(id);
  }, []);

  const clearActiveDetailView = useCallback(() => {
    setActiveFilePath(null);
    setActiveFlowId(null);
    setActiveDbId(null);
  }, [setActiveFilePath, setActiveFlowId, setActiveDbId]);

  const showFileView = useCallback((path: string | null) => {
    setActiveFilePath(path);
    setActiveFlowId(null);
    setActiveDbId(null);
  }, [setActiveFilePath, setActiveFlowId, setActiveDbId]);

  const handleSelectTab = useCallback((path: string | null) => {
    showFileView(path);
  }, [showFileView]);

  const showFlowView = useCallback((flowId: string | null) => {
    setActiveFlowId(flowId);
    setActiveFilePath(null);
    setActiveDbId(null);
  }, [setActiveFlowId, setActiveFilePath, setActiveDbId]);

  const showDatabaseView = useCallback((dbId: string | null) => {
    setActiveDbId(dbId);
    setActiveFilePath(null);
    setActiveFlowId(null);
  }, [setActiveDbId, setActiveFilePath, setActiveFlowId]);

  const handleLeftTabChange = useCallback((tab: LeftTab | null) => {
    setLeftTab(tab);

    if (tab && MAIN_CONTENT_TABS.has(tab)) {
      clearActiveDetailView();
    }
  }, [setLeftTab, clearActiveDetailView]);

  const handleOpenFlow = useCallback((flowId: string, pinned: boolean) => {
    setOpenFlows((prev) => {
      const existing = prev.find((f) => f.id === flowId);
      if (existing) {
        return prev.map((f) => f.id === flowId ? { ...f, pinned: pinned || f.pinned } : f);
      }
      if (pinned) {
        return [...prev, { id: flowId, name: 'Flow', pinned: true }];
      }
      const hasUnpinned = prev.find((f) => !f.pinned);
      if (hasUnpinned) {
        return prev.map((f) => !f.pinned ? { id: flowId, name: 'Flow', pinned: false } : f);
      }
      return [...prev, { id: flowId, name: 'Flow', pinned: false }];
    });
    showFlowView(flowId);
  }, [showFlowView]);

  const handleOpenDatabase = useCallback((dbId: string, dbName: string, pinned: boolean) => {
    setOpenDatabases((prev) => {
      const existing = prev.find((d) => d.id === dbId);
      if (existing) {
        return prev.map((d) => d.id === dbId ? { ...d, pinned: pinned || d.pinned } : d);
      }
      if (pinned) {
        return [...prev, { id: dbId, name: dbName, pinned: true }];
      }
      const hasUnpinned = prev.find((d) => !d.pinned);
      if (hasUnpinned) {
        return prev.map((d) => !d.pinned ? { id: dbId, name: dbName, pinned: false } : d);
      }
      return [...prev, { id: dbId, name: dbName, pinned: false }];
    });
    showDatabaseView(dbId);
  }, [showDatabaseView]);

  const handleCloseDatabase = useCallback((dbId: string) => {
    setOpenDatabases((prev) => prev.filter((d) => d.id !== dbId));
    if (activeDbId === dbId) {
      const remaining = openDatabases.filter((d) => d.id !== dbId);
      setActiveDbId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  }, [openDatabases, activeDbId, setActiveDbId]);

  const currentBranch = repo?.defaultBranch;
  const { isConnected, analysisProgress, clearProgress, onEvent } = useSocket(repoId);
  const { violations: rawViolations, allViolations: rawAllViolations, isLoading: violationsLoading, refetch: refetchViolations } = useViolations(repoId, selectedService ?? undefined, selectedAnalysisId ?? undefined);
  const { diffResult, isChecking: isDiffChecking, error: diffError, run: runDiffCheckAnalysis, load: loadDiffCheck } = useDiffCheck(repoId);

  // In diff mode with no diff result yet, show no violations
  const emptyViolations = isDiffMode && !diffResult;
  const violations = emptyViolations ? [] : rawViolations;
  const allViolations = emptyViolations ? [] : rawAllViolations;
  const { analyses, refetch: refetchAnalyses } = useAnalysisList(repoId);
  const graphAnalysisId = isDiffMode && diffResult?.diffAnalysisId
    ? diffResult.diffAnalysisId
    : selectedAnalysisId ?? undefined;
  const { nodes, edges, savedCollapsedIds, isLoading: graphLoading, error: graphError, refetch: refetchGraph } =
    useGraph(repoId, currentBranch, depthLevel, graphAnalysisId);

  const { summary: rawCodeViolationSummary, refetch: refetchCodeViolationSummary } = useCodeViolationSummary(repoId, graphAnalysisId);
  const codeViolationSummary = emptyViolations ? undefined : rawCodeViolationSummary;
  const { flows: flowList, severities: rawFlowSeverities, isLoading: flowsLoading, refetch: refetchFlows } = useFlows(repoId);
  const flowSeverities = emptyViolations ? {} : rawFlowSeverities;

  const isViewingHistory = !!selectedAnalysisId;
  const selectedAnalysis = selectedAnalysisId ? analyses.find((a) => a.id === selectedAnalysisId) : null;

  // Fetch repo details
  const [repoError, setRepoError] = useState<string | null>(null);
  useEffect(() => {
    if (!repoId) return;
    api.getRepo(repoId).then(setRepo).catch((err) => {
      setRepoError(err instanceof Error ? err.message : 'Failed to load repository');
    });
  }, [repoId]);

  // Load saved diff check on mount when URL has view=diff
  useEffect(() => {
    if (isDiffMode) loadDiffCheck();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize filtered data
  useEffect(() => {
    setFilteredNodes(nodes);
    setFilteredEdges(edges);
  }, [nodes, edges]);

  // Sync isAnalyzing with server-side progress (handles page refresh mid-analysis)
  // Skip in diff mode — diff check uses isDiffChecking instead
  useEffect(() => {
    if (analysisProgress && !isAnalyzing && !isDiffMode) {
      setIsAnalyzing(true);
    }
  }, [analysisProgress, isAnalyzing, isDiffMode]);

  // Listen for analysis complete to refetch
  useEffect(() => {
    const unsub = onEvent('analysis:complete', () => {
      setIsAnalyzing(false);
      // Don't set isCodeReviewing here — the code-review:progress event handles that
      refetchGraph();
      refetchAnalyses();
      refetchCodeViolationSummary();
      refetchFlows();
    });
    return unsub;
  }, [onEvent, refetchGraph, refetchAnalyses, refetchCodeViolationSummary, refetchFlows]);

  // Listen for violations ready
  useEffect(() => {
    const unsub = onEvent('violations:ready', () => {
      setIsAnalyzing(false);
      refetchViolations();
      refetchCodeViolationSummary();
    });
    return unsub;
  }, [onEvent, refetchViolations, refetchCodeViolationSummary]);

  // Listen for background code review completion
  useEffect(() => {
    const unsub1 = onEvent('code-review:progress', () => {
      setIsCodeReviewing(true);
    });
    const unsub2 = onEvent('code-review:ready', () => {
      setIsCodeReviewing(false);
      refetchViolations();
      refetchCodeViolationSummary();
      refetchAnalyses();
    });
    return () => { unsub1(); unsub2(); };
  }, [onEvent, refetchViolations, refetchCodeViolationSummary, refetchAnalyses]);

  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const handleAnalyze = async (options?: { codeReview?: boolean }) => {
    if (isDiffMode) {
      runDiffCheckAnalysis();
    } else {
      try {
        setIsAnalyzing(true);
        setAnalysisError(null);
        await api.analyzeRepo(repoId, { codeReview: options?.codeReview });
      } catch (error) {
        setIsAnalyzing(false);
        setAnalysisError(error instanceof Error ? error.message : 'Analysis failed');
      }
    }
  };

  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedService(nodeId);

    if (nodeId) {
      const clickedNode = nodes.find((n) => n.id === nodeId);
      if (clickedNode && clickedNode.type === 'database') {
        setSelectedDatabaseId(nodeId);
        setLeftTab('violations');
        return;
      }
    }
    setSelectedDatabaseId(null);
  }, [nodes]);

  const handleExplainNode = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    const data = node?.data as Record<string, unknown> | undefined;
    const nodeName = (data?.label as string) || nodeId;

    // Build context from node data and its connections
    const nodeContext: Record<string, unknown> = {};
    if (data) {
      const { onExplain, onToggleCollapse, isCollapsed, isContainer, ...relevant } = data as Record<string, unknown>;
      Object.assign(nodeContext, relevant);
    }

    // Add parent info
    if (node?.parentId) {
      const parent = nodes.find((n) => n.id === node.parentId);
      if (parent) {
        nodeContext.parentName = (parent.data as Record<string, unknown>)?.label;
        nodeContext.parentType = parent.type;
      }
    }

    // Add dependencies (edges to/from this node)
    const inbound = edges.filter((e) => e.target === nodeId).map((e) => {
      const source = nodes.find((n) => n.id === e.source);
      return { from: (source?.data as Record<string, unknown>)?.label, type: (e.data as Record<string, unknown>)?.dependencyType };
    });
    const outbound = edges.filter((e) => e.source === nodeId).map((e) => {
      const target = nodes.find((n) => n.id === e.target);
      return { to: (target?.data as Record<string, unknown>)?.label, type: (e.data as Record<string, unknown>)?.dependencyType };
    });
    if (inbound.length) nodeContext.dependedOnBy = inbound;
    if (outbound.length) nodeContext.dependsOn = outbound;

    setSelectedService(nodeId);
    setIsChatOpen(true);
    setExplainRequest({ nodeId, nodeName, nodeType: node?.type, nodeContext });
  }, [nodes, edges]);

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
        const parentMap = new Map<string, string>();
        for (const n of nodes) {
          const pid = (n as Record<string, unknown>).parentId as string | undefined;
          if (pid) parentMap.set(n.id, pid);
        }

        if (!filters.showDatabases) {
          for (const n of nodes) {
            if (n.type === 'database') hiddenIds.add(n.id);
          }
        }

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

        if (filters.excludedLayers.size > 0) {
          for (const n of nodes) {
            if (n.type !== 'layer') continue;
            const d = n.data as Record<string, unknown>;
            if (filters.excludedLayers.has(d.label as string)) {
              hiddenIds.add(n.id);
            }
          }
        }

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

  const setIsDiffMode = useCallback((diff: boolean) => {
    setIsDiffModeState(diff);
    const url = new URL(window.location.href);
    if (diff) {
      url.searchParams.set('view', 'diff');
    } else {
      url.searchParams.delete('view');
    }
    navigate(url.pathname + url.search, { replace: true });
  }, [navigate]);

  const handleEnterDiffMode = useCallback(() => {
    setIsDiffMode(true);
    loadDiffCheck();
  }, [setIsDiffMode, loadDiffCheck]);

  const handleExitDiffMode = useCallback(() => {
    setIsDiffMode(false);
  }, [setIsDiffMode]);

  // Transform nodes when diff mode is active with results
  const diffFilteredNodes = useMemo(() => {
    if (!isDiffMode || !diffResult) return filteredNodes;

    const affectedServiceSet = new Set(diffResult.affectedNodeIds.services);
    const affectedLayerSet = new Set(diffResult.affectedNodeIds.layers);
    const affectedModuleSet = new Set(diffResult.affectedNodeIds.modules);
    const affectedMethodSet = new Set(diffResult.affectedNodeIds.methods);

    const newByService = new Map<string, number>();
    const resolvedByService = new Map<string, number>();
    const newByModule = new Map<string, number>();
    const newByMethod = new Map<string, number>();
    const resolvedByModule = new Map<string, number>();
    const resolvedByMethod = new Map<string, number>();

    for (const v of diffResult.newViolations) {
      if (v.targetServiceName) {
        newByService.set(v.targetServiceName, (newByService.get(v.targetServiceName) || 0) + 1);
      }
      if (v.targetModuleName && v.targetServiceName) {
        const key = `${v.targetServiceName}::${v.targetModuleName}`;
        newByModule.set(key, (newByModule.get(key) || 0) + 1);
      }
      if (v.targetMethodName && v.targetModuleName && v.targetServiceName) {
        const key = `${v.targetServiceName}::${v.targetModuleName}::${v.targetMethodName}`;
        newByMethod.set(key, (newByMethod.get(key) || 0) + 1);
      }
    }

    for (const v of (diffResult.resolvedViolations || [])) {
      if (v.targetServiceName) {
        resolvedByService.set(v.targetServiceName, (resolvedByService.get(v.targetServiceName) || 0) + 1);
      }
      if (v.targetModuleName && v.targetServiceName) {
        const key = `${v.targetServiceName}::${v.targetModuleName}`;
        resolvedByModule.set(key, (resolvedByModule.get(key) || 0) + 1);
      }
      if (v.targetMethodName && v.targetModuleName && v.targetServiceName) {
        const key = `${v.targetServiceName}::${v.targetModuleName}::${v.targetMethodName}`;
        resolvedByMethod.set(key, (resolvedByMethod.get(key) || 0) + 1);
      }
    }

    const getServiceName = (node: Node): string => {
      let current = node;
      while (true) {
        const pid = (current as Record<string, unknown>).parentId as string | undefined;
        if (!pid) return '';
        const parent = filteredNodes.find((n) => n.id === pid);
        if (!parent) return '';
        if (parent.type === 'serviceGroup') {
          return (parent.data as Record<string, unknown>).label as string;
        }
        current = parent;
      }
    };

    return filteredNodes.map((node) => {
      const d = node.data as Record<string, unknown>;
      const label = d.label as string;

      if (node.type === 'service' || node.type === 'serviceGroup') {
        const serviceName = label;
        const isAffected = affectedServiceSet.has(serviceName);
        return {
          ...node,
          data: {
            ...d,
            diffBadge: isAffected ? {
              newCount: newByService.get(serviceName) || 0,
              resolvedCount: resolvedByService.get(serviceName) || 0,
            } : undefined,
          },
          style: isAffected ? node.style : { ...node.style, opacity: 0.4 },
        };
      }

      if (node.type === 'layer') {
        const parentId = (node as Record<string, unknown>).parentId as string | undefined;
        const parent = parentId ? filteredNodes.find((n) => n.id === parentId) : undefined;
        const serviceName = parent ? (parent.data as Record<string, unknown>).label as string : '';
        const layerKey = `${serviceName}::${label}`;
        const isAffected = affectedLayerSet.has(layerKey);
        return {
          ...node,
          data: {
            ...d,
            diffBadge: isAffected ? { newCount: 0, resolvedCount: 0 } : undefined,
          },
          style: isAffected ? node.style : { ...node.style, opacity: 0.4 },
        };
      }

      if (node.type === 'module') {
        const serviceName = getServiceName(node);
        const moduleKey = `${serviceName}::${label}`;
        const isAffected = affectedModuleSet.has(moduleKey);
        return {
          ...node,
          data: {
            ...d,
            diffBadge: isAffected ? {
              newCount: newByModule.get(moduleKey) || 0,
              resolvedCount: resolvedByModule.get(moduleKey) || 0,
            } : undefined,
          },
          style: isAffected ? node.style : { ...node.style, opacity: 0.4 },
        };
      }

      if (node.type === 'method') {
        const serviceName = getServiceName(node);
        const pid = (node as Record<string, unknown>).parentId as string | undefined;
        const parentModule = pid ? filteredNodes.find((n) => n.id === pid) : undefined;
        const moduleName = parentModule ? (parentModule.data as Record<string, unknown>).label as string : '';
        const methodKey = `${serviceName}::${moduleName}::${label}`;
        const isAffected = affectedMethodSet.has(methodKey);
        return {
          ...node,
          data: {
            ...d,
            diffBadge: isAffected ? {
              newCount: newByMethod.get(methodKey) || 0,
              resolvedCount: resolvedByMethod.get(methodKey) || 0,
            } : undefined,
          },
          style: isAffected ? node.style : { ...node.style, opacity: 0.4 },
        };
      }

      return {
        ...node,
        style: { ...node.style, opacity: 0.4 },
      };
    });
  }, [filteredNodes, isDiffMode, diffResult]);

  // Check if a node's absolute file path relates to the selected relative path.
  const pathMatches = useCallback((absPath: string, relSelected: string): boolean => {
    if (!absPath || !relSelected) return false;
    if (absPath.includes(relSelected)) return true;
    const absParts = absPath.split('/');
    for (let i = absParts.length - 1; i >= 1; i--) {
      const suffix = absParts.slice(i).join('/');
      if (relSelected.startsWith(suffix + '/') || relSelected === suffix) return true;
    }
    return false;
  }, []);

  // Path-based filtering: dim nodes not matching selectedPath
  const pathFilteredNodes = useMemo(() => {
    const base = isDiffMode ? diffFilteredNodes : filteredNodes;
    if (!selectedPath) return base;

    const parentMap = new Map<string, string>();
    for (const n of base) {
      const pid = (n as Record<string, unknown>).parentId as string | undefined;
      if (pid) parentMap.set(n.id, pid);
    }

    const matchingIds = new Set<string>();

    for (const n of base) {
      const d = n.data as Record<string, unknown>;
      let matches = false;

      if (n.type === 'module' || n.type === 'method') {
        const fp = (d.filePath as string) || (d.rootPath as string) || '';
        if (pathMatches(fp, selectedPath)) matches = true;
      } else if (n.type === 'layer') {
        const fps = d.filePaths as string[] | undefined;
        if (fps?.some((fp) => pathMatches(fp, selectedPath))) matches = true;
      } else if (n.type === 'serviceGroup') {
        const rp = (d.rootPath as string) || '';
        if (pathMatches(rp, selectedPath)) matches = true;
      } else if (n.type === 'service') {
        const info = d.serviceInfo as Record<string, unknown> | undefined;
        const rp = (info?.rootPath as string) || '';
        if (pathMatches(rp, selectedPath)) matches = true;
      }

      if (matches) {
        matchingIds.add(n.id);
        let pid = parentMap.get(n.id);
        while (pid) {
          matchingIds.add(pid);
          pid = parentMap.get(pid);
        }
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const n of base) {
        if (matchingIds.has(n.id)) continue;
        const pid = parentMap.get(n.id);
        if (!pid || !matchingIds.has(pid)) continue;
        const d = n.data as Record<string, unknown>;
        if (n.type === 'module' || n.type === 'method') {
          const fp = (d.filePath as string) || (d.rootPath as string) || '';
          if (pathMatches(fp, selectedPath)) {
            matchingIds.add(n.id);
            changed = true;
          }
        } else if (n.type === 'layer') {
          const fps = d.filePaths as string[] | undefined;
          if (fps?.some((fp) => pathMatches(fp, selectedPath))) {
            matchingIds.add(n.id);
            changed = true;
          }
        }
      }
    }

    return base.map((n) =>
      matchingIds.has(n.id) ? n : { ...n, style: { ...n.style, opacity: 0.15 } }
    );
  }, [filteredNodes, diffFilteredNodes, isDiffMode, selectedPath, pathMatches]);

  // Set of node IDs that are highlighted (not dimmed) by path filter
  const highlightedNodeIds = useMemo(() => {
    if (!selectedPath) return null;
    const ids = new Set<string>();
    for (const n of pathFilteredNodes) {
      if ((n.style as Record<string, unknown>)?.opacity !== 0.15) {
        ids.add(n.id);
      }
    }
    return ids;
  }, [pathFilteredNodes, selectedPath]);

  // Build nodeId → filePath map for violation filtering
  const nodeFilePathMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) {
      const d = n.data as Record<string, unknown>;
      let fp = (d.filePath as string) || (d.rootPath as string);
      if (!fp && n.type === 'service') {
        const info = d.serviceInfo as Record<string, unknown> | undefined;
        fp = (info?.rootPath as string) || '';
      }
      if (fp) map.set(n.id, fp);
    }
    return map;
  }, [nodes]);


  if (!repoId) {
    return <Navigate to="/" replace />;
  }

  const selectedServiceName = selectedService
    ? ((nodes.find((n) => n.id === selectedService)?.data as Record<string, unknown>)?.label as string) ?? null
    : null;

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

  const handleLocateNode = useCallback((nodeId: string, requiredDepth?: string) => {
    if (requiredDepth && requiredDepth !== depthLevel) {
      setDepthLevel(requiredDepth as DepthLevel);
      setTimeout(() => setFocusRequest({ nodeId, key: Date.now() }), 500);
    } else {
      setFocusRequest({ nodeId, key: Date.now() });
    }
  }, [depthLevel]);

  // Whether we're showing a file tab (code viewer), flow diagram, or database tab instead of graph
  const showingCodeViewer = activeFilePath !== null;
  const showingFlow = activeFlowId !== null && !showingCodeViewer;
  const showingDatabase = activeDbId !== null && !showingCodeViewer && !showingFlow;

  // Update flow names when flow list loads
  useEffect(() => {
    if (flowList.length === 0) return;
    setOpenFlows((prev) =>
      prev.map((f) => {
        const match = flowList.find((fl) => fl.id === f.id);
        return match ? { ...f, name: match.name } : f;
      })
    );
  }, [flowList]);

  return (
    <div className="flex h-screen flex-col">
      <Header
        repoName={repo?.name}
        currentBranch={currentBranch}
        onAnalyze={isViewingHistory || repoError ? undefined : handleAnalyze}
        onCodeReview={(() => {
          if (isViewingHistory) return undefined;
          if (isDiffMode) {
            const diffId = diffResult?.diffAnalysisId;
            if (!diffId || diffResult.codeReview) return undefined;
            return async () => {
              try {
                setIsCodeReviewing(true);
                await api.runCodeReview(repoId, diffId);
              } catch {
                setIsCodeReviewing(false);
              }
            };
          }
          if (!analyses?.length) return undefined;
          const currentAnalysis = analyses[0];
          if (currentAnalysis.codeReview) return undefined;
          return async () => {
            try {
              setIsCodeReviewing(true);
              await api.runCodeReview(repoId, currentAnalysis.id);
            } catch {
              setIsCodeReviewing(false);
            }
          };
        })()}
        isAnalyzing={isAnalyzing || isDiffChecking}
        isCodeReviewing={isCodeReviewing}
        showBack
        backHref="/"
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen((v) => !v)}
        isDiffMode={isDiffMode}
        onEnterDiffMode={isViewingHistory ? undefined : handleEnterDiffMode}
        onExitDiffMode={isViewingHistory ? undefined : handleExitDiffMode}
        analyses={analyses}
        selectedAnalysisId={selectedAnalysisId}
        onSelectAnalysis={setSelectedAnalysisId}
        currentAnalysisId={graphAnalysisId || (isDiffMode ? undefined : analyses?.[0]?.id)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: icon rail + violations/rules panel */}
        <LeftSidebar activeTab={leftTab} onTabChange={handleLeftTabChange} isCodeReviewing={isCodeReviewing} badgeCounts={{
          violations: isDiffMode && diffResult
            ? { newCount: diffResult.summary.newCount, resolvedCount: diffResult.summary.resolvedCount }
            : allViolations.length,
          flows: flowList.length,
          databases: nodes.filter((n) => n.type === 'database').length,
          analyses: analyses.length,
        }}>
          {leftTab === 'violations' && (
            <ViolationsPanel
              violations={violations}
              isLoading={violationsLoading}
              repoId={repoId}
              selectedService={selectedService}
              selectedServiceName={selectedServiceName}
              selectedDatabaseId={selectedDatabaseId}
              isDiffMode={isDiffMode}
              diffResult={diffResult}
              onLocateNode={handleLocateNode}
              onOpenFile={handleOpenFile}
              onClearFilter={() => { handleNodeSelect(null); setSelectedPath(null); }}
              selectedPath={selectedPath}
              nodeFilePathMap={nodeFilePathMap}
              onOpenDatabaseInTab={(dbId, dbName) => handleOpenDatabase(dbId, dbName, true)}
            />
          )}
          {leftTab === 'rules' && <RulesPanel />}
          {leftTab === 'flows' && (
            <FlowList
              flows={flowList}
              isLoading={flowsLoading}
              onSelectFlow={handleOpenFlow}
              activeFlowId={activeFlowId}
              flowSeverities={flowSeverities}
            />
          )}
          {leftTab === 'databases' && (
            <DatabaseList
              repoId={repoId}
              branch={currentBranch}
              activeDbId={activeDbId}
              onSelectDatabase={handleOpenDatabase}
            />
          )}
          {leftTab === 'files' && (
            <FileTree
              repoId={repoId}
              selectedPath={selectedPath}
              onOpenFile={handleOpenFile}
              violationCounts={codeViolationSummary?.byFile}
              violationSeverities={codeViolationSummary?.highestSeverityByFile}
              revealPath={activeFilePath}
              isDiffMode={isDiffMode}
              onSelectPath={(path) => {
                setSelectedPath(path);
                if (!path) {
                  handleNodeSelect(null);
                  return;
                }
                let bestMatch: { id: string; depth: number } | null = null;
                for (const n of nodes) {
                  if (n.type !== 'service' && n.type !== 'serviceGroup') continue;
                  const d = n.data as Record<string, unknown>;
                  let rp = '';
                  if (n.type === 'service') {
                    const info = d.serviceInfo as Record<string, unknown> | undefined;
                    rp = (info?.rootPath as string) || '';
                  } else {
                    rp = (d.rootPath as string) || '';
                  }
                  if (!rp) continue;
                  const rpParts = rp.split('/');
                  for (let i = rpParts.length - 1; i >= 0; i--) {
                    const suffix = rpParts.slice(i).join('/');
                    if (path.startsWith(suffix) || path.startsWith(suffix + '/')) {
                      const depth = rpParts.length - i;
                      if (!bestMatch || depth > bestMatch.depth) {
                        bestMatch = { id: n.id, depth };
                      }
                      break;
                    }
                  }
                }
                handleNodeSelect(bestMatch?.id ?? null);
              }}
            />
          )}
        </LeftSidebar>

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab bar when files or flows are open */}
          {(openFiles.length > 0 || openFlows.length > 0 || openDatabases.length > 0) && (
            <div className="flex shrink-0 items-center border-b border-border bg-card text-xs overflow-x-auto">
              {/* Home tab */}
              <button
                onClick={clearActiveDetailView}
                className={`shrink-0 px-3 py-1.5 border-r border-border transition-colors ${
                  !showingCodeViewer && !showingFlow && !showingDatabase
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                Home
              </button>
              {/* File tabs */}
              {openFiles.map((file) => {
                const fileName = file.path.split('/').pop() || file.path;
                const isActive = activeFilePath === file.path;
                return (
                  <div
                    key={file.path}
                    onClick={() => handleSelectTab(file.path)}
                    className={`group shrink-0 flex items-center gap-1 px-3 py-1.5 border-r border-border cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                    title={file.path}
                  >
                    <span className={file.pinned ? 'font-medium' : 'italic'}>{fileName}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseFile(file.path);
                      }}
                      className={`rounded p-0.5 hover:bg-muted transition-opacity ${
                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              {/* Flow tabs */}
              {openFlows.map((flow) => {
                const isActive = activeFlowId === flow.id && !showingCodeViewer;
                return (
                  <div
                    key={flow.id}
                    onClick={() => showFlowView(flow.id)}
                    className={`group shrink-0 flex items-center gap-1 px-3 py-1.5 border-r border-border cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                    title={flow.name}
                  >
                    <Workflow className="h-3 w-3 shrink-0" />
                    <span className={flow.pinned ? 'font-medium' : 'italic'}>{flow.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseFlow(flow.id);
                      }}
                      className={`rounded p-0.5 hover:bg-muted transition-opacity ${
                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              {/* Database tabs */}
              {openDatabases.map((db) => {
                const isActive = activeDbId === db.id && !showingCodeViewer && !showingFlow;
                return (
                  <div
                    key={db.id}
                    onClick={() => showDatabaseView(db.id)}
                    className={`group shrink-0 flex items-center gap-1 px-3 py-1.5 border-r border-border cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                    title={db.name}
                  >
                    <Database className="h-3 w-3 shrink-0" />
                    <span className={db.pinned ? 'font-medium' : 'italic'}>{db.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseDatabase(db.id);
                      }}
                      className={`rounded p-0.5 hover:bg-muted transition-opacity ${
                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Historical analysis banner — only on graph tab */}
          {!showingCodeViewer && isViewingHistory && selectedAnalysis && (
            <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 text-xs text-amber-500">
              <span>
                Viewing analysis from{' '}
                {new Date(selectedAnalysis.createdAt).toLocaleString([], {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}{' '}
                — not the latest
              </span>
              <button
                className="underline hover:text-amber-400 transition-colors"
                onClick={() => setSelectedAnalysisId(null)}
              >
                Return to latest
              </button>
            </div>
          )}

          {/* Diff mode banner */}
          {isDiffMode && diffResult?.diffAnalysisId && (
            <div className="flex shrink-0 items-center justify-center gap-2 bg-blue-500/10 border-b border-blue-500/30 px-4 py-1.5 text-xs text-blue-400">
              <span>Showing working tree state (uncommitted changes)</span>
            </div>
          )}

          <div className="relative flex-1 overflow-hidden">
          {/* Analysis error banner */}
          {analysisError && (
            <div className="absolute bottom-4 left-1/2 z-20 w-96 -translate-x-1/2 rounded-lg border border-destructive/50 bg-card p-3 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-destructive">Analysis failed</span>
                <button
                  onClick={() => setAnalysisError(null)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 translate-y-px text-destructive" />
                <span className="text-[11px] text-muted-foreground">{analysisError}</span>
              </div>
            </div>
          )}
          {/* Analysis progress — step checklist */}
          {analysisProgress && (
            <div className={`absolute bottom-4 left-1/2 z-20 w-80 -translate-x-1/2 rounded-lg border bg-card p-3 shadow-lg ${
              analysisProgress.step === 'error' ? 'border-destructive/50' : 'border-border'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[11px] font-medium ${
                  analysisProgress.step === 'error' ? 'text-destructive' : 'text-foreground'
                }`}>{analysisProgress.step === 'error' ? 'Analysis failed' : 'Analyzing...'}</span>
                <button
                  onClick={() => {
                    if (analysisProgress.step === 'error') {
                      clearProgress();
                      setIsAnalyzing(false);
                    } else {
                      repoId && api.cancelAnalysis(repoId).catch(() => {});
                    }
                  }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={analysisProgress.step === 'error' ? 'Dismiss' : 'Cancel analysis'}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {analysisProgress.step === 'error' ? (
                <div className="flex items-start gap-2">
                  <CircleX className="h-3.5 w-3.5 shrink-0 translate-y-px text-destructive" />
                  <span className="text-[11px] text-muted-foreground">{analysisProgress.detail || 'An error occurred'}</span>
                </div>
              ) : analysisProgress.steps && analysisProgress.steps.length > 0 ? (
                <div className="space-y-1">
                  {analysisProgress.steps.map((s) => (
                    <div key={s.key} className="flex items-center gap-2">
                      <div className="shrink-0 translate-y-px">
                        {s.status === 'done' && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                        {s.status === 'active' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                        {s.status === 'error' && <CircleX className="h-3.5 w-3.5 text-destructive" />}
                        {s.status === 'pending' && <div className="h-2.5 w-2.5 rounded-full border border-muted-foreground/30" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className={`text-[11px] leading-[18px] ${
                          s.status === 'active' ? 'font-medium text-foreground' :
                          s.status === 'done' ? 'text-muted-foreground' :
                          s.status === 'error' ? 'text-destructive' :
                          'text-muted-foreground/60'
                        }`}>
                          {s.label}
                          {s.detail && s.status !== 'pending' && (
                            <span className="ml-1.5 font-normal text-[10px] text-muted-foreground/70">{s.detail}</span>
                          )}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                  <span className="text-[11px] text-muted-foreground">{analysisProgress.detail || analysisProgress.step}</span>
                </div>
              )}
            </div>
          )}

          {/* Code viewer */}
          {showingCodeViewer && activeFilePath ? (
            <CodeViewerPanel
              repoId={repoId}
              filePath={activeFilePath}
              analysisId={graphAnalysisId}
              scrollToLine={openFiles.find((f) => f.path === activeFilePath)?.scrollToLine}
              isDiffMode={isDiffMode}
              onClose={() => handleCloseFile(activeFilePath)}
            />
          ) : showingFlow && activeFlowId ? (
            <FlowDiagramPanel
              repoId={repoId}
              flowId={activeFlowId}
            />
          ) : showingDatabase && activeDbId ? (
            <SchemaPanel
              repoId={repoId}
              databaseId={activeDbId}
              violations={violations}
              isTab
            />
          ) : leftTab === 'analytics' ? (
            <AnalyticsDashboard
              repoId={repoId}
              branch={currentBranch}
              analysisId={graphAnalysisId}
              onNavigateToNode={(nodeId, kind) => {
                setLeftTab('violations');
                handleLocateNode(nodeId, kind === 'module' ? 'modules' : 'services');
              }}
              onOpenFile={(filePath) => {
                handleOpenFile(filePath, true);
              }}
            />
          ) : leftTab === 'analyses' ? (
            <AnalysesPanel
              analyses={analyses}
              isLoading={false}
              currentAnalysisId={graphAnalysisId || (isDiffMode ? undefined : analyses?.[0]?.id)}
              selectedAnalysisId={selectedAnalysisId}
              onSelectAnalysis={setSelectedAnalysisId}
              onDeleteAnalysis={async (analysisId) => {
                await api.deleteAnalysis(repoId, analysisId);
                setSelectedAnalysisId(null);
                refetchAnalyses();
                refetchViolations();
                refetchGraph();
                refetchCodeViolationSummary();
                refetchFlows();
                if (isDiffMode) loadDiffCheck();
              }}
              repoId={repoId}
            />
          ) : (
          <>

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
          ) : repoError ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertCircle className="h-10 w-10 text-amber-500" />
                <Alert className="max-w-sm border-amber-500/30">
                  <AlertTitle className="text-amber-500">Repository warning</AlertTitle>
                  <AlertDescription className="text-amber-500/90">{repoError}</AlertDescription>
                </Alert>
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
                  onClick={() => handleAnalyze()}
                  disabled={isAnalyzing}
                  className="mt-2"
                >
                  {isAnalyzing && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isAnalyzing ? 'Analyzing...' : 'Analyze Repository'}
                </Button>
                {isDiffMode && diffError && (
                  <Alert className="mt-3 max-w-sm border-amber-500/30 text-amber-500">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-amber-500/90">{diffError}</AlertDescription>
                  </Alert>
                )}
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
                initialNodes={pathFilteredNodes}
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
                isDiffMode={isDiffMode}
                diffResult={diffResult}
                isDiffChecking={isDiffChecking}
                hasProgressBar={!!analysisProgress}
                onEnterDiffMode={handleEnterDiffMode}
                onExitDiffMode={handleExitDiffMode}
                highlightedNodeIds={highlightedNodeIds}
                savedCollapsedIds={savedCollapsedIds}
              />
            </>
          )}
          </>
          )}
          </div>
        </div>

        {/* Right sidebar: Chat only */}
        <Sidebar isOpen={isChatOpen}>
          <ChatPanel
            repoId={repoId}
            selectedService={selectedService}
            explainRequest={explainRequest}
            onExplainHandled={() => setExplainRequest(null)}
          />
        </Sidebar>
      </div>
    </div>
  );
}
