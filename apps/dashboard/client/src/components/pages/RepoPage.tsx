
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { Loader2, AlertCircle, Wifi, WifiOff, X, Workflow, Database, Check, CircleX, FileText } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LeftSidebar, type LeftTab } from '@/components/layout/LeftSidebar';
import {
  NavigationProvider,
  useNavigation,
} from '@/contexts/NavigationContext';
import {
  GraphViewProvider,
  useGraphView,
} from '@/contexts/GraphViewContext';
import {
  OpenTabsProvider,
  useOpenTabs,
} from '@/contexts/OpenTabsContext';
import {
  DriftViewProvider,
  useDriftView,
} from '@/contexts/DriftViewContext';
import {
  ViewModeProvider,
  useViewMode,
} from '@/contexts/ViewModeContext';
import { SpecHeaderActions } from '@/components/spec/SpecHeaderActions';
import { SpecPanePlaceholder } from '@/components/spec/SpecPanePlaceholder';
import { SpecProgressPopup } from '@/components/spec/SpecProgressPopup';
import { ContractsPanel } from '@/components/drift/ContractsPanel';
import { ContractsFile } from '@/components/drift/ContractsFile';
import { VerifyPanel, type DriftFilterTarget } from '@/components/drift/VerifyPanel';
import { VerifyStatsColumn, type DriftFilters } from '@/components/drift/VerifyStatsColumn';
import { VerifyRunsPanel } from '@/components/drift/VerifyRunsPanel';
import { VerifyHeaderActions } from '@/components/drift/VerifyHeaderActions';
import { VerifyDriftDetail, VerifyEmptyState } from '@/components/drift/VerifyDriftDetail';
import { useVerifyState } from '@/hooks/useVerifyState';
import { useContractsGenerate } from '@/hooks/useContractsGenerate';
import { useSpecStaleness } from '@/hooks/useSpecStaleness';
import { ContractsHeaderActions } from '@/components/drift/ContractsHeaderActions';
import { ContractsGenerateResultToaster } from '@/components/drift/ContractsGenerateResultToaster';
import { DecisionsPanel } from '@/components/drift/DecisionsPanel';
import { GraphCanvas } from '@/components/graph/GraphCanvas';
import { HomePanel } from '@/components/pages/HomePanel';
import { FileTree } from '@/components/files/FileTree';
import { FlowList } from '@/components/flows/FlowList';
import { FlowDiagramPanel } from '@/components/flows/FlowDiagramPanel';
import { CodeViewerPanel } from '@/components/code/CodeViewerPanel';
import { SchemaPanel } from '@/components/schema/SchemaPanel';
import { DatabaseList } from '@/components/schema/DatabaseList';
import { AnalysesPanel } from '@/components/analyses/AnalysesPanel';
import { SpecPanel } from '@/components/spec/SpecPanel';
import { SpecProvider } from '@/components/spec/SpecContext';
import { SpecConflictDetail } from '@/components/spec/SpecConflictDetail';
import { SpecCanonicalFile } from '@/components/spec/SpecCanonicalFile';
import { useGraph } from '@/hooks/useGraph';
import { useContractsTree } from '@/hooks/useContractsTree';
import { useCanonicalSpecTree } from '@/hooks/useCanonicalSpecTree';
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
import type { RepoResponse, DriftSeverity, VerifyState } from '@/lib/api';
import type { Node, Edge } from '@xyflow/react';

// Outer shell: mounts the navigation context (top-level section +
// active left tab, kept in sync with the URL) so the page body and
// every panel read/write it through `useNavigation()` instead of
// having it prop-drilled out of one giant component.
export default function RepoPage() {
  return (
    <NavigationProvider>
      <GraphViewProvider>
        <OpenTabsProvider>
          <DriftViewProvider>
            <ViewModeProvider>
              <RepoPageInner />
            </ViewModeProvider>
          </DriftViewProvider>
        </OpenTabsProvider>
      </GraphViewProvider>
    </NavigationProvider>
  );
}

function RepoPageInner() {
  const { repoId = '' } = useParams();
  // Section + active tab live in NavigationContext now; bound to the
  // same local names the rest of this component already uses.
  const {
    section: dashboardSection,
    leftTab,
    setSection: setDashboardSection,
    setLeftTab,
  } = useNavigation();
  // Graph depth / scope / focus + selected node live in GraphViewContext;
  // bound to the same local names the rest of this component uses.
  const {
    selectedService,
    setSelectedService,
    depthLevel,
    setDepthLevel,
    scopedServiceId,
    setScopedServiceId,
    scopedModuleId,
    setScopedModuleId,
    focusRequest,
    locateNode: handleLocateNode,
  } = useGraphView();
  // Diff toggle, history selection, and path highlight live in
  // ViewModeContext; bound to the same local names used below.
  const {
    isDiffMode,
    setIsDiffMode,
    selectedAnalysisId,
    setSelectedAnalysisId,
    selectedPath,
    setSelectedPath,
  } = useViewMode();
  const [repo, setRepo] = useState<RepoResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // File / flow / database viewer tabs live in OpenTabsContext; bound
  // to the same local names the rest of this component uses.
  const {
    openFiles,
    activeFilePath,
    handleOpenFile,
    handleCloseFile,
    openFlows,
    activeFlowId,
    handleOpenFlow,
    handleCloseFlow,
    syncFlowNames,
    openDatabases,
    activeDbId,
    handleOpenDatabase,
    handleCloseDatabase,
    handleSelectTab,
    showFlowView,
    showDatabaseView,
    handleLeftTabChange,
  } = useOpenTabs();

  // Spec / canonical / contracts / verify-drift view state lives in
  // DriftViewContext; bound to the same local names used below.
  const {
    activeSpecConflictId,
    setActiveSpecConflictId,
    handleSelectSpecConflict,
    activeCanonicalPath,
    setActiveCanonicalPath,
    openCanonicalFiles,
    handleOpenCanonical,
    handleCloseCanonical,
    activeContractsPath,
    setActiveContractsPath,
    openContractsFiles,
    handleOpenContracts,
    handleCloseContracts,
    activeDriftId,
    setActiveDriftId,
    openDriftTabs,
    handleOpenDrift,
    handleCloseDrift,
    reconcileDriftTabs,
  } = useDriftView();

  const currentBranch = repo?.defaultBranch;
  const {
    isConnected,
    analysisProgress,
    specProgress,
    clearProgress,
    clearSpecProgress,
    onEvent,
    llmEstimate,
    respondToLlmEstimate,
    stashConfirm,
    respondToStashConfirm,
  } = useSocket(repoId);

  useEffect(() => {
    if (!stashConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') respondToStashConfirm(stashConfirm.repoId, 'cancel');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stashConfirm, respondToStashConfirm]);

  useEffect(() => {
    if (!llmEstimate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') respondToLlmEstimate(llmEstimate.repoId, false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [llmEstimate, respondToLlmEstimate]);

  // Note: graph node clicks store into `selectedService` for visual highlight only —
  // we deliberately don't pass it to useViolations so the violations list is never
  // filtered as a side effect of clicking a graph node.
  // Mirror the per-tab refetch pattern used by useFlows / useCodeViolationSummary /
  // useGraph: the hook re-fetches whenever `enabled` flips true again. The
  // violations list is only rendered inside HomePanel, so gating strictly on
  // 'home' guarantees a refetch on every entry into the Home tab — including
  // from Graphs or Databases, which both kept enabled=true under the broader
  // gate and silently skipped the refresh. Other consumers (SchemaPanel ER
  // annotations, sidebar badge count) keep the last fetched value.
  const { violations: rawViolations, allViolations: rawAllViolations, isLoading: violationsLoading, refetch: refetchViolations } =
    useViolations(repoId, undefined, selectedAnalysisId ?? undefined, { enabled: leftTab === 'home' });
  const { diffResult, isChecking: isDiffChecking, error: diffError, run: runDiffCheckAnalysis, load: loadDiffCheck } = useDiffCheck(repoId, onEvent);

  // In diff mode with no diff result yet, show no violations
  const emptyViolations = isDiffMode && !diffResult;
  const violations = emptyViolations ? [] : rawViolations;
  const allViolations = emptyViolations ? [] : rawAllViolations;
  const { analyses, refetch: refetchAnalyses } = useAnalysisList(repoId);
  const graphAnalysisId = isDiffMode && diffResult?.diffAnalysisId
    ? diffResult.diffAnalysisId
    : selectedAnalysisId ?? undefined;
  // Defer heavy tab-specific fetches so Home doesn't compete with the analytics
  // and violations calls on repo-page mount. Graph data is only needed by tabs
  // that actually render the graph or derive lists from its nodes.
  const graphNeededForTab =
    leftTab === 'graphs' || leftTab === 'files' || leftTab === 'databases';

  const { nodes, edges, savedCollapsedIds, scopes: graphScopes, isLoading: graphLoading, error: graphError, refetch: refetchGraph } =
    useGraph(repoId, {
      branch: currentBranch,
      level: depthLevel,
      analysisId: graphAnalysisId,
      scopedServiceId,
      scopedModuleId,
      enabled: graphNeededForTab,
    });

  // Auto-select when exactly one option is available for the current depth.
  useEffect(() => {
    if (depthLevel === 'modules' && !scopedServiceId && graphScopes.services.length === 1) {
      setScopedServiceId(graphScopes.services[0].id);
    }
  }, [depthLevel, scopedServiceId, graphScopes.services, setScopedServiceId]);

  useEffect(() => {
    if (depthLevel !== 'methods' || scopedModuleId) return;
    const candidates = scopedServiceId
      ? graphScopes.modules.filter((m) => m.serviceId === scopedServiceId)
      : graphScopes.modules;
    if (candidates.length === 1) {
      setScopedModuleId(candidates[0].id);
    }
  }, [depthLevel, scopedModuleId, scopedServiceId, graphScopes.modules, setScopedModuleId]);

  const { summary: rawCodeViolationSummary, refetch: refetchCodeViolationSummary } =
    useCodeViolationSummary(repoId, graphAnalysisId, { enabled: leftTab === 'files' });
  const codeViolationSummary = emptyViolations ? undefined : rawCodeViolationSummary;
  const { flows: flowList, severities: rawFlowSeverities, isLoading: flowsLoading, refetch: refetchFlows } =
    useFlows(repoId, { enabled: leftTab === 'flows', analysisId: graphAnalysisId });
  const flowSeverities = emptyViolations ? {} : rawFlowSeverities;

  // BL Drift trees — same pattern as useGraph/useFlows. Hoisted here
  // so the data survives tab switches and so spec:complete socket
  // events (fired after a successful Apply) can refetch both via the
  // listeners below.
  const {
    tree: contractsTree,
    isLoading: contractsLoading,
    error: contractsError,
    refetch: refetchContracts,
  } = useContractsTree(repoId);
  const {
    tree: canonicalTree,
    isLoading: canonicalLoading,
    error: canonicalError,
    refetch: refetchCanonical,
  } = useCanonicalSpecTree(repoId);
  const {
    state: verifyState,
    diff: verifyDiff,
    history: verifyHistory,
    isLoading: verifyLoading,
    isRunning: verifyRunning,
    isDiffing: verifyDiffing,
    error: verifyError,
    refetch: refetchVerify,
    run: runVerify,
    runDiff: runVerifyDiff,
  } = useVerifyState(repoId);
  const {
    generating: contractsGenerating,
    result: contractsGenerateResult,
    run: runContractsGenerate,
  } = useContractsGenerate(repoId);
  const {
    contractsStale,
    verifyStale,
    refetch: refetchStaleness,
  } = useSpecStaleness(repoId);
  // Verify Normal / Git Diff view mode shares analyze's `isDiffMode`
  // (URL `?view=diff`) so the toggle persists across reloads exactly like
  // analyze. Toggling only switches the view — the diff is computed by the
  // run button (below) while in diff mode, not on toggle.
  // Analytics-driven drift filters (set by clicking the left charts, applied to
  // the center list). Each toggles off when its active value is re-clicked,
  // mirroring analyze's severity/category/path filters.
  const [driftFilters, setDriftFilters] = useState<DriftFilters>({
    severity: null,
    kind: null,
    file: null,
  });
  const toggleDriftSeverity = useCallback(
    (s: string) =>
      setDriftFilters((f) => ({ ...f, severity: f.severity === s ? null : (s as DriftSeverity) })),
    [],
  );
  const toggleDriftKind = useCallback(
    (k: string) => setDriftFilters((f) => ({ ...f, kind: f.kind === k ? null : k })),
    [],
  );
  const toggleDriftFile = useCallback(
    (file: string) => setDriftFilters((f) => ({ ...f, file: f.file === file ? null : file })),
    [],
  );
  const clearDriftFilter = useCallback(
    (target: DriftFilterTarget) => setDriftFilters((f) => ({ ...f, [target]: null })),
    [],
  );
  // Resizable analytics aside for the verify view, mirroring analyze's
  // HomePanel aside (charts on the left, list + detail to the right).
  const [verifyPanelWidth, setVerifyPanelWidth] = useState(560);
  const verifyDragging = useRef(false);
  const handleVerifyResizeDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      verifyDragging.current = true;
      const startX = e.clientX;
      const startW = verifyPanelWidth;
      const onMove = (ev: MouseEvent) => {
        if (!verifyDragging.current) return;
        const delta = ev.clientX - startX;
        setVerifyPanelWidth(Math.min(800, Math.max(320, startW + delta)));
      };
      const onUp = () => {
        verifyDragging.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [verifyPanelWidth],
  );
  // Past-run viewing, mirroring analyze's selectedAnalysisId. When set, the
  // verify view shows that run's snapshot read-only (diff disabled).
  const [selectedVerifyRunId, setSelectedVerifyRunId] = useState<string | null>(null);
  const [verifyRunState, setVerifyRunState] = useState<VerifyState | null>(null);
  useEffect(() => {
    if (!selectedVerifyRunId || !repoId) {
      setVerifyRunState(null);
      return;
    }
    let cancelled = false;
    api
      .getVerifyRun(repoId, selectedVerifyRunId)
      .then((s) => {
        if (!cancelled) setVerifyRunState(s);
      })
      .catch(() => {
        if (!cancelled) setVerifyRunState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedVerifyRunId, repoId]);
  const isViewingVerifyRun = !!selectedVerifyRunId;
  // What the verify columns actually render: a selected past run, else LATEST.
  const effectiveVerifyState = isViewingVerifyRun ? verifyRunState : verifyState;
  // Diff is latest-only; a past run is always shown in normal mode.
  const effectiveVerifyDiffMode = isDiffMode && !isViewingVerifyRun;
  // Newest-first run list for the dropdown (history is appended oldest-first).
  const verifyRunItems = useMemo(
    () =>
      [...verifyHistory.runs].reverse().map((r) => {
        const d = new Date(r.verifiedAt);
        return {
          id: r.id,
          label: Number.isNaN(d.getTime())
            ? r.verifiedAt
            : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        };
      }),
    [verifyHistory],
  );
  const selectedVerifyRunLabel = isViewingVerifyRun
    ? verifyRunItems.find((r) => r.id === selectedVerifyRunId)?.label ?? null
    : null;
  // Runs page: open a run in the Verify tab; delete a run from history.
  const handleViewVerifyRun = useCallback(
    (runId: string | null) => {
      setSelectedVerifyRunId(runId);
      setLeftTab('verify');
    },
    [setLeftTab],
  );
  const handleDeleteVerifyRun = useCallback(
    async (runId: string) => {
      await api.deleteVerifyRun(repoId, runId);
      setSelectedVerifyRunId((cur) => (cur === runId ? null : cur));
      await refetchVerify();
    },
    [repoId, refetchVerify],
  );
  // When the underlying verify run changes (re-run / fresh load), drop
  // any open drift tabs whose ids no longer exist so we never show a
  // stale tab pointing at nothing, and clear filters / past-run selection.
  // Diff mode is intentionally NOT reset here — it's URL-derived (`isDiffMode`),
  // so the post-diff refetch no longer kicks the user back to Normal.
  useEffect(() => {
    reconcileDriftTabs(
      verifyState ? new Set(verifyState.drifts.map((d) => d.id)) : null,
    );
    setDriftFilters({ severity: null, kind: null, file: null });
    setSelectedVerifyRunId(null);
  }, [verifyState, reconcileDriftTabs]);

  const isViewingHistory = !!selectedAnalysisId;
  const selectedAnalysis = selectedAnalysisId ? analyses.find((a) => a.id === selectedAnalysisId) : null;

  // Fetch repo details
  const [repoError, setRepoError] = useState<string | null>(null);
  useEffect(() => {
    if (!repoId) return;
    api.getRepo(repoId).then((data) => {
      setRepo(data);
      // Restore analysis state from DB on page load
      const status = data.latestAnalysis?.status;
      if (status === 'running') {
        setIsAnalyzing(true);
      } else if (status === 'cancelling') {
        setIsAnalyzing(true);
        setIsCancelling(true);
      }
    }).catch((err) => {
      setRepoError(err instanceof Error ? err.message : 'Failed to load repository');
    });
  }, [repoId]);

  // Load saved diff check on mount when URL has view=diff
  useEffect(() => {
    if (isDiffMode) loadDiffCheck();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync isAnalyzing with server-side progress (handles page refresh mid-analysis)
  // Skip in diff mode — diff check uses isDiffChecking instead
  useEffect(() => {
    if (analysisProgress && !isAnalyzing && !isDiffMode) {
      setIsAnalyzing(true);
    }
  }, [analysisProgress, isAnalyzing, isDiffMode]);

  // Listen for analysis complete/canceled to update state
  useEffect(() => {
    const unsub1 = onEvent('analysis:complete', () => {
      setIsAnalyzing(false);
      setIsCancelling(false);
      refetchGraph();

      refetchAnalyses();
      refetchCodeViolationSummary();
      refetchFlows();
      // Refresh repo so `lastAnalyzed` updates — this drives the transition
      // out of the welcome empty state.
      api.getRepo(repoId).then(setRepo).catch(() => {});
    });
    const unsub2 = onEvent('analysis:canceled', () => {
      setIsAnalyzing(false);
      setIsCancelling(false);
    });
    return () => { unsub1(); unsub2(); };
  }, [onEvent, refetchGraph, refetchAnalyses, refetchCodeViolationSummary, refetchFlows, repoId]);

  // Refresh BL Drift trees after a successful Scan / Generate /
  // Verify. The server emits `spec:complete` with one of three kinds —
  // we fan out to the relevant hook's refetch so each tree stays in
  // sync without polling. Scan rewrites claims.json (refetchCanonical),
  // Generate writes contracts (refetchContracts), Verify writes the
  // drift state (refetchVerify).
  useEffect(() => {
    const unsub = onEvent('spec:complete', (data) => {
      const payload = data as
        | { kind?: 'scan' | 'generate' | 'verify' }
        | undefined;
      if (payload?.kind === 'scan') {
        refetchCanonical();
      } else if (payload?.kind === 'generate') {
        refetchContracts();
      } else if (payload?.kind === 'verify') {
        refetchVerify();
      }
      // Every lifecycle event can flip a staleness dot — a scan
      // rewrites claims.json (contractsStale on), a generate clears it,
      // a verify clears verifyStale.
      if (
        payload?.kind === 'scan' ||
        payload?.kind === 'generate' ||
        payload?.kind === 'verify'
      ) {
        refetchStaleness();
      }
    });
    return unsub;
  }, [onEvent, refetchCanonical, refetchContracts, refetchVerify, refetchStaleness]);

  // Listen for violations ready
  useEffect(() => {
    const unsub = onEvent('violations:ready', () => {
      setIsAnalyzing(false);
      refetchViolations();
      refetchCodeViolationSummary();
    });
    return unsub;
  }, [onEvent, refetchViolations, refetchCodeViolationSummary]);

  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const handleAnalyze = async () => {
    if (isDiffMode) {
      runDiffCheckAnalysis();
    } else {
      try {
        setIsAnalyzing(true);
        setAnalysisError(null);
        await api.analyzeRepo(repoId);
        // POST /analyze returns 202 once the DB has been bootstrapped.
        // Refetch the read endpoints so any NO_PROJECT_DB 404s from
        // before this click clear out and the layout shows the progress
        // overlay instead of the stale error state.
        refetchGraph();
        refetchAnalyses();
        refetchViolations();
        refetchCodeViolationSummary();
        refetchFlows();
      } catch (error) {
        setIsAnalyzing(false);
        setAnalysisError(error instanceof Error ? error.message : 'Analysis failed');
      }
    }
  };


  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedService(nodeId);

    if (nodeId) {
      const clickedNode = nodes.find((n) => n.id === nodeId);
      if (clickedNode && clickedNode.type === 'database') {
        const dbName = (clickedNode.data as { label?: string })?.label ?? 'Database';
        handleOpenDatabase(nodeId, dbName, true);
        return;
      }
    }
  }, [nodes, handleOpenDatabase]);


  const handleEnterDiffMode = useCallback(() => {
    setIsDiffMode(true);
    loadDiffCheck();
  }, [setIsDiffMode, loadDiffCheck]);

  const handleExitDiffMode = useCallback(() => {
    setIsDiffMode(false);
  }, [setIsDiffMode]);

  // Transform nodes when diff mode is active with results
  const diffFilteredNodes = useMemo(() => {
    if (!isDiffMode || !diffResult) return nodes;

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
        const parent = nodes.find((n) => n.id === pid);
        if (!parent) return '';
        if (parent.type === 'serviceGroup') {
          return (parent.data as Record<string, unknown>).label as string;
        }
        current = parent;
      }
    };

    return nodes.map((node) => {
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
        const parent = parentId ? nodes.find((n) => n.id === parentId) : undefined;
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
        const parentModule = pid ? nodes.find((n) => n.id === pid) : undefined;
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
  }, [nodes, isDiffMode, diffResult]);

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
    const base = isDiffMode ? diffFilteredNodes : nodes;
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
  }, [nodes, diffFilteredNodes, isDiffMode, selectedPath, pathMatches]);

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

  const handleLocateNodeFromHome = useCallback((
    nodeId: string,
    requiredDepth?: string,
    hints?: { serviceId?: string | null; moduleId?: string | null },
  ) => {
    setLeftTab('graphs');
    handleLocateNode(nodeId, requiredDepth, hints);
  }, [setLeftTab, handleLocateNode]);

  // Whether we're showing a file tab (code viewer), flow diagram, or database tab instead of graph
  // Each detail view is gated on its owning tab. Active IDs persist across tab
  // switches so returning to Files/Flows/Databases reopens the last-viewed item.
  const showingCodeViewer = activeFilePath !== null && leftTab === 'files';
  const showingFlow = activeFlowId !== null && leftTab === 'flows';
  const showingDatabase = activeDbId !== null && leftTab === 'databases';
  const showingSpecConflict =
    activeSpecConflictId !== null &&
    (leftTab === 'spec' || leftTab === 'decisions');
  const showingCanonicalFile = activeCanonicalPath !== null && leftTab === 'spec';
  const showingContractsFile = activeContractsPath !== null && leftTab === 'contracts';

  const hasAnalysis = repo?.lastAnalyzed != null;

  // Update flow names when flow list loads
  useEffect(() => {
    syncFlowNames(flowList);
  }, [flowList, syncFlowNames]);

  return (
    <SpecProvider repoId={repoId}>
    <div className="flex h-screen flex-col">
      <Header
        repoName={repo?.name}
        currentBranch={currentBranch}
        onAnalyze={
          dashboardSection !== 'analysis' || isViewingHistory || repoError || repo?.isGitRepo === false
            ? undefined
            : handleAnalyze
        }
        isAnalyzing={isAnalyzing || isDiffChecking}
        showBack
        backHref="/"
        isDiffMode={isDiffMode}
        onEnterDiffMode={
          dashboardSection !== 'analysis' || isViewingHistory ? undefined : handleEnterDiffMode
        }
        onExitDiffMode={
          dashboardSection !== 'analysis' || isViewingHistory ? undefined : handleExitDiffMode
        }
        analyses={analyses}
        selectedAnalysisId={selectedAnalysisId}
        onSelectAnalysis={setSelectedAnalysisId}
        currentAnalysisId={graphAnalysisId || (isDiffMode ? undefined : analyses?.[0]?.id)}
        dashboardSection={dashboardSection}
        onDashboardSectionChange={setDashboardSection}
        sectionActions={
          leftTab === 'spec' ? (
            <SpecHeaderActions />
          ) : leftTab === 'contracts' ? (
            <ContractsHeaderActions
              isGenerating={contractsGenerating}
              onGenerate={runContractsGenerate}
              stale={contractsStale}
            />
          ) : leftTab === 'verify' ? (
            <VerifyHeaderActions
              isRunning={isDiffMode ? verifyDiffing : verifyRunning}
              onRun={isDiffMode ? runVerifyDiff : runVerify}
              stale={verifyStale}
              diffMode={isDiffMode}
              onToggleDiff={setIsDiffMode}
              isGitRepo={repo?.isGitRepo !== false}
              runItems={verifyRunItems}
              selectedRunId={selectedVerifyRunId}
              onSelectRun={setSelectedVerifyRunId}
              viewingHistory={isViewingVerifyRun}
            />
          ) : null
        }
      />

      {/* Page-level banners — span full width above both sidebar and main. */}
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
      {isDiffMode && diffResult?.diffAnalysisId && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 text-xs text-amber-500">
          <span>Showing working tree state (uncommitted changes)</span>
        </div>
      )}
      {leftTab === 'verify' && isViewingVerifyRun && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 text-xs text-amber-500">
          <span>
            Viewing verify run{selectedVerifyRunLabel ? ` from ${selectedVerifyRunLabel}` : ''} — not the latest
          </span>
          <button
            className="underline hover:text-amber-400 transition-colors"
            onClick={() => setSelectedVerifyRunId(null)}
          >
            Return to latest
          </button>
        </div>
      )}
      {repoError && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-destructive/10 border-b border-destructive/30 px-4 py-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{repoError}</span>
        </div>
      )}
      {!repoError && repo?.isGitRepo === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 text-xs text-amber-500">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>This directory is not a git repository — branch switching and history are unavailable.</span>
        </div>
      )}

      {/* Generate result surfaces as a toast (sonner's <Toaster />
          lives at the app root). Render-less side effect — listens
          for new results and emits toasts, no layout impact. */}
      <ContractsGenerateResultToaster result={contractsGenerateResult} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: icon rail + violations/rules panel */}
        <LeftSidebar
          section={dashboardSection}
          activeTab={leftTab}
          onTabChange={handleLeftTabChange}
          badgeCounts={{
            home: allViolations.length,
            flows: flowList.length,
            databases: nodes.filter((n) => n.type === 'database').length,
            analyses: analyses.length,
          }}
        >
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
              analysisId={graphAnalysisId}
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
          {leftTab === 'spec' && (
            <SpecPanel
              canonicalTree={canonicalTree}
              canonicalLoading={canonicalLoading}
              canonicalError={canonicalError}
              activeConflictId={activeSpecConflictId}
              onSelectConflict={handleSelectSpecConflict}
              activeCanonicalPath={activeCanonicalPath}
              onOpenCanonicalFile={handleOpenCanonical}
            />
          )}
          {leftTab === 'contracts' && (
            <ContractsPanel
              tree={contractsTree}
              isLoading={contractsLoading}
              error={contractsError}
              activePath={activeContractsPath}
              validationIssues={
                contractsGenerateResult &&
                'il' in contractsGenerateResult &&
                'validationIssues' in contractsGenerateResult.il
                  ? contractsGenerateResult.il.validationIssues
                  : undefined
              }
              onOpen={handleOpenContracts}
            />
          )}
          {leftTab === 'decisions' && (
            <DecisionsPanel
              activeConflictId={activeSpecConflictId}
              onSelectConflict={handleSelectSpecConflict}
            />
          )}
        </LeftSidebar>

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab bar only on tabs where opening items makes sense (Files/Flows/Databases/Spec canonical/Contracts/Verify) */}
          {((leftTab === 'files' || leftTab === 'flows' || leftTab === 'databases') &&
            (openFiles.length > 0 || openFlows.length > 0 || openDatabases.length > 0)) ||
          (leftTab === 'spec' && openCanonicalFiles.length > 0) ||
          (leftTab === 'contracts' && openContractsFiles.length > 0) ? (
            <div className="flex shrink-0 items-center border-b border-border bg-card text-xs overflow-x-auto">
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
              {/* Canonical spec tabs */}
              {leftTab === 'spec' && openCanonicalFiles.map((f) => {
                const fileName = f.path.split('/').pop() || f.path;
                const isActive = activeCanonicalPath === f.path;
                return (
                  <div
                    key={f.path}
                    onClick={() => setActiveCanonicalPath(f.path)}
                    className={`group shrink-0 flex items-center gap-1 px-3 py-1.5 border-r border-border cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                    title={f.path}
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className={f.pinned ? 'font-medium' : 'italic'}>{fileName}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseCanonical(f.path);
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
              {/* Contracts tabs */}
              {leftTab === 'contracts' && openContractsFiles.map((f) => {
                const fileName = f.path.split('/').pop() || f.path;
                const isActive = activeContractsPath === f.path;
                return (
                  <div
                    key={f.path}
                    onClick={() => setActiveContractsPath(f.path)}
                    className={`group shrink-0 flex items-center gap-1 px-3 py-1.5 border-r border-border cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                    title={f.path}
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className={f.pinned ? 'font-medium' : 'italic'}>{fileName}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseContracts(f.path);
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
              {/* Verify drifts use the 3-column view (no tab bar). */}
            </div>
          ) : null}

          <div className="relative flex-1 overflow-hidden">
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
              analysisId={graphAnalysisId}
              canEnrich={!isDiffMode && !selectedAnalysisId}
            />
          ) : showingDatabase && activeDbId ? (
            <SchemaPanel
              repoId={repoId}
              databaseId={activeDbId}
              analysisId={graphAnalysisId}
              violations={violations}
              isTab
            />
          ) : showingCanonicalFile && activeCanonicalPath ? (
            <SpecCanonicalFile repoId={repoId} filePath={activeCanonicalPath} />
          ) : showingSpecConflict && activeSpecConflictId ? (
            <SpecConflictDetail
              conflictId={activeSpecConflictId}
              onClose={() => setActiveSpecConflictId(null)}
            />
          ) : leftTab === 'spec' ? (
            <SpecPanePlaceholder />
          ) : showingContractsFile && activeContractsPath ? (
            <ContractsFile repoId={repoId} filePath={activeContractsPath} />
          ) : leftTab === 'contracts' ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <p>Select a contract file from the list to view it.</p>
            </div>
          ) : leftTab === 'verify' ? (
            (() => {
              // Verify view, mirroring analyze's HomePanel layout: a resizable
              // analytics aside on the LEFT, then the drift list, then the
              // selected drift's detail. `effectiveVerifyState` is a past run
              // when one is selected, else LATEST.
              const activeDrift =
                (effectiveVerifyDiffMode
                  ? [...(verifyDiff?.added ?? []), ...(verifyDiff?.resolved ?? [])]
                  : effectiveVerifyState?.drifts ?? []
                ).find((d) => d.id === activeDriftId) ?? null;
              return (
                <div className="flex h-full w-full overflow-hidden">
                  <aside
                    style={{ width: verifyPanelWidth }}
                    className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-card"
                  >
                    <VerifyStatsColumn
                      state={effectiveVerifyState}
                      diff={verifyDiff}
                      history={verifyHistory}
                      mode={effectiveVerifyDiffMode ? 'diff' : 'current'}
                      isDiffing={verifyDiffing}
                      filters={driftFilters}
                      onToggleSeverity={toggleDriftSeverity}
                      onToggleKind={toggleDriftKind}
                      onToggleFile={toggleDriftFile}
                    />
                    <div
                      className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
                      onMouseDown={handleVerifyResizeDown}
                    />
                  </aside>
                  <div className="w-[380px] shrink-0 overflow-hidden border-r border-border">
                    <VerifyPanel
                      state={effectiveVerifyState}
                      diff={verifyDiff}
                      mode={effectiveVerifyDiffMode ? 'diff' : 'current'}
                      isLoading={verifyLoading}
                      isDiffing={verifyDiffing}
                      error={verifyError}
                      activeDriftId={activeDriftId}
                      filters={driftFilters}
                      onClearFilter={clearDriftFilter}
                      onOpenDrift={handleOpenDrift}
                    />
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    {activeDrift ? (
                      <VerifyDriftDetail
                        drift={activeDrift}
                        onClose={() => handleCloseDrift(activeDrift.id)}
                        onOpenFile={(filePath, line) => {
                          // Cross-section navigation: switch to Code Analysis
                          // and open the file viewer at the right line.
                          setDashboardSection('analysis');
                          handleOpenFile(filePath, true, line);
                        }}
                      />
                    ) : (
                      <VerifyEmptyState />
                    )}
                  </div>
                </div>
              );
            })()
          ) : leftTab === 'runs' ? (
            <VerifyRunsPanel
              history={verifyHistory}
              selectedRunId={selectedVerifyRunId}
              onViewRun={handleViewVerifyRun}
              onDeleteRun={handleDeleteVerifyRun}
            />
          ) : leftTab === 'decisions' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
              <p className="max-w-md">
                Every conflict you've resolved in the Spec tab lives in the
                ledger on the left. Revoke a decision to re-open its
                conflict — your other candidates are preserved.
              </p>
            </div>
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
          ) : leftTab === 'home' ? (
            repo == null ? (
              <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <HomePanel
                key={repo.lastAnalyzed ?? 'unanalyzed'}
                repoId={repoId}
                branch={currentBranch}
                analysisId={graphAnalysisId}
                hasAnalysis={hasAnalysis}
                violations={violations}
                violationsLoading={violationsLoading}
                isDiffMode={isDiffMode}
                diffResult={diffResult}
                onLocateNode={handleLocateNodeFromHome}
                onOpenFile={handleOpenFile}
                onRefreshAfterDisable={refetchViolations}
              />
            )
          ) : leftTab === 'graphs' ? (
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
          ) : graphError && !isAnalyzing ? (
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
          ) : nodes.length === 0 && nodes.length === 0 &&
              !(depthLevel === 'modules' && !scopedServiceId) &&
              !(depthLevel === 'methods' && !scopedModuleId) ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertCircle className="h-10 w-10 text-muted-foreground" />
                <Alert className="max-w-sm">
                  <AlertTitle>No graph data</AlertTitle>
                  <AlertDescription>
                    Run an analysis to generate the architecture graph
                  </AlertDescription>
                </Alert>
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
              <GraphCanvas
                initialNodes={pathFilteredNodes}
                initialEdges={edges}
                onNodeSelect={handleNodeSelect}
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
                scopes={graphScopes}
                scopedServiceId={scopedServiceId}
                scopedModuleId={scopedModuleId}
                onScopedServiceChange={setScopedServiceId}
                onScopedModuleChange={(id) => {
                  setScopedModuleId(id);
                  if (id) {
                    const mod = graphScopes.modules.find((m) => m.id === id);
                    if (mod && mod.serviceId && mod.serviceId !== scopedServiceId) {
                      setScopedServiceId(mod.serviceId);
                    }
                  }
                }}
              />
            </>
          )}
          </>
          ) : (
            <div className="flex h-full items-center justify-center text-center">
              <p className="max-w-xs text-sm text-muted-foreground">
                {leftTab === 'files'
                  ? 'Pick a file from the tree to preview it here.'
                  : leftTab === 'flows'
                    ? 'Pick a flow to view its sequence diagram here.'
                    : leftTab === 'databases'
                      ? 'Pick a database to view its schema here.'
                      : null}
              </p>
            </div>
          )}
          </div>
        </div>

      </div>

      {/* Global analysis overlays — float over any tab. */}
      {analysisError && (
        <div className="fixed bottom-4 left-1/2 z-40 w-96 -translate-x-1/2 rounded-lg border border-destructive/50 bg-card p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
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
      {stashConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => respondToStashConfirm(stashConfirm.repoId, 'cancel')}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-96 rounded-lg border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <span className="text-xs font-medium text-foreground">Stash pending changes?</span>
              <button
                onClick={() => respondToStashConfirm(stashConfirm.repoId, 'cancel')}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mb-4 text-[11px] text-muted-foreground">
              Your repository has {stashConfirm.modifiedCount} modified and{' '}
              {stashConfirm.untrackedCount} untracked file(s).
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                onClick={() => respondToStashConfirm(stashConfirm.repoId, 'stash')}
              >
                Stash and analyze committed state
              </button>
              <button
                className="rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                onClick={() => respondToStashConfirm(stashConfirm.repoId, 'no-stash')}
              >
                Don't stash — analyze working tree as-is
              </button>
            </div>
          </div>
        </div>
      )}
      {llmEstimate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => respondToLlmEstimate(llmEstimate.repoId, false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-96 rounded-lg border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <span className="text-xs font-medium text-foreground">Run LLM rules?</span>
              <button
                onClick={() => respondToLlmEstimate(llmEstimate.repoId, false)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Skip"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mb-4 text-[11px] text-muted-foreground">
              {(() => {
                const totalRules = llmEstimate.estimate.tiers.reduce((s, t) => s + t.ruleCount, 0);
                const totalFiles = llmEstimate.estimate.tiers.reduce((s, t) => s + t.fileCount, 0);
                return `${totalFiles} files, ${totalRules} rules (~${Math.round(llmEstimate.estimate.totalEstimatedTokens / 1000)}k tokens).`;
              })()}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                onClick={() => respondToLlmEstimate(llmEstimate.repoId, true)}
              >
                Run LLM rules
              </button>
              <button
                className="rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                onClick={() => respondToLlmEstimate(llmEstimate.repoId, false)}
              >
                Skip — deterministic rules only
              </button>
            </div>
          </div>
        </div>
      )}
      {analysisProgress && (
        <div
          className={`fixed bottom-4 left-1/2 z-40 w-80 -translate-x-1/2 rounded-lg border bg-card p-3 shadow-lg ${
            analysisProgress.step === 'error' ? 'border-destructive/50' : 'border-border'
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span
              className={`text-[11px] font-medium ${
                analysisProgress.step === 'error' ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {analysisProgress.step === 'error'
                ? 'Analysis failed'
                : isCancelling
                  ? 'Cancelling...'
                  : 'Analyzing...'}
            </span>
            {analysisProgress.step === 'error' ? (
              <button
                onClick={() => {
                  clearProgress();
                  setIsAnalyzing(false);
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : isCancelling ? (
              <span className="shrink-0 px-1.5 py-0.5 text-[10px] text-amber-500">Cancelling...</span>
            ) : (
              <button
                onClick={() => {
                  if (repoId) {
                    api.cancelAnalysis(repoId).catch(() => {});
                    setIsCancelling(true);
                  }
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>
          {analysisProgress.step === 'error' ? (
            <div className="flex items-start gap-2">
              <CircleX className="h-3.5 w-3.5 shrink-0 translate-y-px text-destructive" />
              <span className="text-[11px] text-muted-foreground">
                {analysisProgress.detail || 'An error occurred'}
              </span>
            </div>
          ) : analysisProgress.steps && analysisProgress.steps.length > 0 ? (
            <div className="space-y-1">
              {analysisProgress.steps.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <div className="shrink-0 translate-y-px">
                    {s.status === 'done' && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                    {s.status === 'active' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                    {s.status === 'error' && <CircleX className="h-3.5 w-3.5 text-destructive" />}
                    {s.status === 'pending' && (
                      <div className="h-2.5 w-2.5 rounded-full border border-muted-foreground/30" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span
                      className={`text-[11px] leading-[18px] ${
                        s.status === 'active'
                          ? 'font-medium text-foreground'
                          : s.status === 'done'
                            ? 'text-muted-foreground'
                            : s.status === 'error'
                              ? 'text-destructive'
                              : 'text-muted-foreground/60'
                      }`}
                    >
                      {s.label}
                      {s.detail && s.status !== 'pending' && (
                        <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/70">
                          {s.detail}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              <span className="text-[11px] text-muted-foreground">
                {analysisProgress.detail || analysisProgress.step}
              </span>
            </div>
          )}
        </div>
      )}
      {specProgress && (
        <SpecProgressPopup progress={specProgress} onDismiss={clearSpecProgress} />
      )}
    </div>
    </SpecProvider>
  );
}
