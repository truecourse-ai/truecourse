
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, Wifi, WifiOff, X, Workflow, Database, Check, CircleX, FileText, FileCode2, Network, Lightbulb } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LeftSidebar, type LeftTab } from '@/components/layout/LeftSidebar';
import { useEdition } from '@/contexts/CapabilityContext';
import { useVisibleTabsForSection } from '@/navigation/registry';
import { EeRepoChrome } from '@/ee/EeRepoChrome';
import { RepoSettings } from '@/ee/RepoSettings';
import { InferredPanel, InferredDecisionDetail } from '@/ee/InferredPanel';
import { useInferredDecisions, inferredKey } from '@/hooks/useInferredDecisions';
import type { InferredDecisionView } from '@truecourse/shared';

/** EE repo tab bar: BL-Drift only, curated order. Analytics leads + is default.
 *  Spec → Decisions → Contracts mirrors the workspace Knowledge page order. */
const EE_REPO_TAB_ORDER = ['driftanalytics', 'verify', 'spec', 'decisions', 'inferred', 'contracts', 'settings'];
/** EE Code Quality (analysis) tab bar: Analytics · Violations, then the common
 *  Settings. The analytics/violations tabs are EE-only (gated on `workspace`);
 *  `settings` is sourced from the drift section (section-neutral, repo-wide
 *  config). The Architecture graph (and Flows/Files/Databases/History) are not
 *  shown in hosted — violations link straight to the code on GitHub instead. */
const EE_ANALYSIS_TAB_ORDER = ['analytics', 'violations', 'settings'];
const EE_ANALYSIS_TAB_LABELS: Record<string, string> = {};
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
import { PullRequestsView } from '@/components/drift/PullRequestsView';
import { VerifyHeaderActions } from '@/components/drift/VerifyHeaderActions';
import { DiffModeToggle } from '@/components/layout/DiffModeToggle';
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
import { SpecProvider, createRepoSpecDataSource } from '@/components/spec/SpecContext';
import { SpecConflictDetail } from '@/components/spec/SpecConflictDetail';
import { SpecCanonicalFile } from '@/components/spec/SpecCanonicalFile';
import { useGraph } from '@/hooks/useGraph';
import { useContractsTree } from '@/hooks/useContractsTree';
import { useCanonicalSpecTree } from '@/hooks/useCanonicalSpecTree';
import { useRepoGateRuns } from '@/ee/useRepoGateRuns';
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
/** An inferred key is `${kind} ${identity}`; the tab label uses the identity part. */
function identityFromInferredKey(key: string): string {
  const sp = key.indexOf(' ');
  return sp === -1 ? key : key.slice(sp + 1);
}

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

  // Enterprise shows ONLY BL Drift on the repo page (no Code Analysis), as a
  // curated horizontal tab bar. Analytics leads and is the default. `pulls` +
  // `runs` are dropped here: PRs live in the header ref selector + the cross-repo
  // sidebar feed, and "Runs" is an OSS-local concept (no local runs in EE).
  const isEe = useEdition() === 'enterprise';
  // PR view (EE): `?pr=N` re-scopes the page to a pull request — the spec/
  // contracts tabs key to its head SHA, the verify tab shows the gate's stored PR
  // diff. Resolved from the repo's gate runs (latest run per PR).
  const [searchParams] = useSearchParams();
  const prParam = searchParams.get('pr');
  const prNumber = isEe && prParam && /^\d+$/.test(prParam) ? Number(prParam) : null;
  const gateRuns = useRepoGateRuns(isEe ? repo?.name : undefined);
  const activePrRun = prNumber != null ? gateRuns.find((r) => r.prNumber === prNumber) ?? null : null;
  // Re-keys the spec/contracts/verify tabs to the PR head (undefined → default branch).
  const refForTabs = prNumber != null ? activePrRun?.headSha : undefined;
  const driftTabs = useVisibleTabsForSection('verification');
  // Code Quality (analysis) tabs — capability gating already drops Flows/Files/
  // Databases in EE (no `local-filesystem`). Curate order + relabel for EE.
  const analysisVisible = useVisibleTabsForSection('codequality');
  const navigate = useNavigate();
  const eeTabs = EE_REPO_TAB_ORDER.map((id) => driftTabs.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    // Settings is repo-wide config, not PR-scoped — hide it while viewing a PR.
    .filter((t) => !(prNumber != null && t.id === 'settings'));
  const analysisTabs = EE_ANALYSIS_TAB_ORDER
    // `settings` is section-neutral — it lives in the drift section, so source its
    // descriptor from there to show it in the Code Quality bar too.
    .map((id) => analysisVisible.find((t) => t.id === id) ?? driftTabs.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    // Settings is repo-wide config — hide it while viewing a PR (same as drift).
    .filter((t) => !(prNumber != null && t.id === 'settings'))
    .map((t) => ({ ...t, label: EE_ANALYSIS_TAB_LABELS[t.id] ?? t.label }));
  // The tab bar shown for the active EE section.
  const eeSectionTabs = dashboardSection === 'codequality' ? analysisTabs : eeTabs;
  useEffect(() => {
    if (!isEe) return;
    // Keep EE in a coherent state: either Verification (drift) or Code Quality
    // (analysis), each with its own curated tab set. Keyed off the EXPLICIT
    // ?section param so the default (no param) lands on Verification — picking
    // Code Quality writes ?section=codequality, which is allowed here.
    const url = new URL(window.location.href);
    const isAnalysis = url.searchParams.get('section') === 'codequality';
    const order = isAnalysis ? EE_ANALYSIS_TAB_ORDER : EE_REPO_TAB_ORDER;
    // Settings is common to both lenses but repo-wide — hidden while viewing a PR.
    const settingsInPr = prNumber != null && leftTab === 'settings';
    const sectionExplicit = isAnalysis || url.searchParams.get('section') === 'verification';
    if (sectionExplicit && leftTab && order.includes(leftTab) && !settingsInPr) return;
    if (!isAnalysis) url.searchParams.set('section', 'verification');
    const t = url.searchParams.get('tab');
    const defaultTab = isAnalysis ? 'analytics' : 'driftanalytics';
    if (!t || !order.includes(t) || (prNumber != null && t === 'settings'))
      url.searchParams.set('tab', defaultTab);
    navigate(url.pathname + url.search, { replace: true });
  }, [isEe, dashboardSection, leftTab, prNumber, navigate]);

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
    useViolations(repoId, undefined, selectedAnalysisId ?? undefined, {
      enabled: leftTab === 'home' || leftTab === 'violations' || leftTab === 'analytics',
    });
  const { diffResult, isChecking: isDiffChecking, error: diffError, run: runDiffCheckAnalysis, load: loadDiffCheck } = useDiffCheck(repoId, onEvent);

  // EE PR Code Quality: show the PR's violation diff (new/resolved vs baseline)
  // instead of the baseline's full list, mirroring the EE verify/drift PR view.
  const prCodeQuality = isEe && prNumber != null && dashboardSection === 'codequality';

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
  } = useContractsTree(repoId, refForTabs);
  // The repo-scoped spec data seam — shared by the SpecProvider below and the
  // canonical tree hook so both read the same source (the EE Knowledge page
  // passes a workspace source instead).
  const specSource = useMemo(
    // EE repos are hosted (Postgres store, no working tree) — the source then
    // refreshes via the server's re-merge instead of an on-demand rescan.
    () => createRepoSpecDataSource(repoId, refForTabs, isEe),
    [repoId, isEe, refForTabs],
  );
  const {
    tree: canonicalTree,
    isLoading: canonicalLoading,
    error: canonicalError,
    refetch: refetchCanonical,
  } = useCanonicalSpecTree(specSource);
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
  } = useVerifyState(repoId, refForTabs, prNumber ?? undefined);
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

  // Switching to a data tab re-fetches its data, so the panel reflects the latest
  // server state without a full page reload. These hooks live at page level (they
  // survive tab switches), so otherwise they only fetch on mount / socket events.
  // A ref holds the latest refetchers so the effect depends ONLY on `leftTab` —
  // it fires on a tab change, never on a refetcher's identity (so no refetch loop).
  // Cheap reads only; we deliberately don't trigger a re-scan here.
  const tabRefetchersRef = useRef({ refetchVerify, refetchContracts, refetchCanonical, refetchStaleness });
  tabRefetchersRef.current = { refetchVerify, refetchContracts, refetchCanonical, refetchStaleness };
  useEffect(() => {
    const r = tabRefetchersRef.current;
    if (leftTab === 'verify') {
      void r.refetchVerify();
      void r.refetchStaleness();
    } else if (leftTab === 'contracts') {
      void r.refetchContracts();
      void r.refetchStaleness();
    } else if (leftTab === 'spec') {
      void r.refetchCanonical();
    }
  }, [leftTab]);
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
  // A PR view IS a diff (the gate's stored added-vs-resolved) — force diff mode.
  const effectiveVerifyDiffMode = prNumber != null || (isDiffMode && !isViewingVerifyRun);
  // GitHub blob deep-link for a drift's file/line, used by the drift detail's
  // "Where in the code" link in the EE / PR context (the local code viewer isn't
  // reachable there). `repo?.name` is the GitHub owner/repo slug for connected
  // EE repos; the commit is the PR head SHA in PR mode, else the commit the shown
  // drifts were observed at — the baseline commit for the base view, the
  // snapshot's commit for a past run (both carried on the verify state), or the
  // diffed commit. Returns null (→ in-app onOpenFile fallback) for local/OSS repos
  // with no GitHub remote or when no commit is known.
  const verifyCommitSha =
    refForTabs ??
    effectiveVerifyState?.commitHash ??
    verifyDiff?.commitHash ??
    null;
  const githubFileUrl = useCallback(
    (path: string, lineStart?: number | null, lineEnd?: number | null): string | null => {
      const repoFullName = isEe ? repo?.name : undefined;
      // Verify supplies the exact commit; Code Quality (analyze) has no verify ref,
      // so fall back to the default branch (the baseline is analyzed on it).
      const ref = verifyCommitSha ?? (isEe ? repo?.defaultBranch : undefined);
      if (!repoFullName || !ref || !path) return null;
      // Only a repo-relative path forms a valid blob URL. Pre-fix snapshots stored
      // an absolute clone path (/tmp/tc-gate-verify-…); fall back rather than emit a
      // broken link (a re-verify now rewrites stored paths repo-relative).
      if (path.startsWith('/')) return null;
      // A spec origin can be an external doc URL (e.g. a workspace Confluence page),
      // not a repo file — never splice that into a blob path. The caller links it
      // directly instead.
      if (/^[a-z][\w+.-]*:\/\//i.test(path)) return null;
      // Generated spec artifacts (claims.json / decisions.json) and synced workspace
      // KB docs (knowledge/<connector>/…) are not committed repo files. The server
      // re-points real claims pointers to their repo doc before we get here; anything
      // still synthetic is genuinely not in the repo, so emit no link (plain text)
      // rather than a 404.
      if (/(^|\/)(claims|decisions)\.json(#|$)/i.test(path)) return null;
      if (path.startsWith('.truecourse/') || path.startsWith('knowledge/')) return null;
      const segments = path.split('/').map((s) => encodeURIComponent(s)).join('/');
      let url = `https://github.com/${repoFullName}/blob/${ref}/${segments}`;
      if (lineStart != null) {
        url += `#L${lineStart}`;
        if (lineEnd != null && lineEnd !== lineStart) url += `-L${lineEnd}`;
      }
      return url;
    },
    [isEe, repo?.name, repo?.defaultBranch, verifyCommitSha],
  );

  // EE has no local files, so opening a violation's file routes to GitHub (the
  // OSS in-app file viewer is capability-gated off). OSS keeps the file viewer.
  const openFile = useCallback(
    (filePath: string, pinned: boolean, line?: number) => {
      if (isEe) {
        const url = githubFileUrl(filePath, line ?? null);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      handleOpenFile(filePath, pinned, line);
    },
    [isEe, githubFileUrl, handleOpenFile],
  );
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

  // EE PR Code Quality: load the per-PR violation diff into diffResult
  useEffect(() => {
    if (prCodeQuality && prNumber != null) loadDiffCheck(prNumber);
  }, [prCodeQuality, prNumber]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Inferred-decisions tab: the data set + main-pane open tabs (transient preview
  // / pinned), mirroring the Contracts open-tabs model. Tabs are held here (the
  // shared parent of the sidebar list and the main-pane detail), keyed by the
  // decision's `${kind} ${identity}`.
  const inferred = useInferredDecisions(
    repoId,
    leftTab === 'inferred',
    prNumber != null ? refForTabs : undefined,
    !isEe && isDiffMode,
  );
  // The open inferred decision lives in `?inferred=<key>` so it survives a refresh
  // and is deep-linkable — same as the spec (`?canonical=`) and contract (`?contract=`)
  // tabs. `key` is `${kind} ${identity}`; the identity (for the tab label) is the
  // part after the leading kind word.
  const inferredFromUrl = searchParams.get('inferred') || null;
  const [openInferredTabs, setOpenInferredTabs] = useState<
    Array<{ key: string; identity: string; pinned: boolean }>
  >(() =>
    inferredFromUrl
      ? [{ key: inferredFromUrl, identity: identityFromInferredKey(inferredFromUrl), pinned: true }]
      : [],
  );
  const [activeInferredKey, setActiveInferredKeyState] = useState<string | null>(inferredFromUrl);

  const setActiveInferredKey = useCallback(
    (key: string | null) => {
      setActiveInferredKeyState(key);
      const url = new URL(window.location.href);
      if (key) url.searchParams.set('inferred', key);
      else url.searchParams.delete('inferred');
      navigate(url.pathname + url.search);
    },
    [navigate],
  );

  // Reset the open tabs when switching repos — but keep an initial deep-link on mount.
  const inferredRepoRef = useRef(repoId);
  useEffect(() => {
    if (inferredRepoRef.current === repoId) return;
    inferredRepoRef.current = repoId;
    setOpenInferredTabs([]);
    setActiveInferredKey(null);
  }, [repoId, setActiveInferredKey]);

  // Follow back/forward (and the setter's own navigate) URL → state.
  useEffect(() => {
    const fromUrl = searchParams.get('inferred') || null;
    setActiveInferredKeyState((cur) => (cur === fromUrl ? cur : fromUrl));
    if (fromUrl) {
      setOpenInferredTabs((prev) =>
        prev.some((t) => t.key === fromUrl)
          ? prev
          : [...prev, { key: fromUrl, identity: identityFromInferredKey(fromUrl), pinned: true }],
      );
    }
  }, [searchParams]);

  const handleOpenInferred = (d: InferredDecisionView, pinned: boolean) => {
    const key = inferredKey(d);
    setOpenInferredTabs((prev) => {
      const existing = prev.find((t) => t.key === key);
      if (existing) return prev.map((t) => (t.key === key ? { ...t, pinned: pinned || t.pinned } : t));
      if (pinned) return [...prev, { key, identity: d.identity, pinned: true }];
      const hasUnpinned = prev.find((t) => !t.pinned);
      if (hasUnpinned) return prev.map((t) => (!t.pinned ? { key, identity: d.identity, pinned: false } : t));
      return [...prev, { key, identity: d.identity, pinned: false }];
    });
    setActiveInferredKey(key);
  };

  const handleCloseInferred = (key: string) => {
    setOpenInferredTabs((prev) => prev.filter((t) => t.key !== key));
    if (activeInferredKey === key) {
      const remaining = openInferredTabs.filter((t) => t.key !== key);
      setActiveInferredKey(remaining.length > 0 ? remaining[remaining.length - 1].key : null);
    }
  };

  const handleInferredAct = async (d: InferredDecisionView, action: 'dismiss' | 'promote') => {
    if (await inferred.act(d, action)) handleCloseInferred(inferredKey(d));
  };

  // Contracts + Spec diffs: EE PR view (head-at-headSha vs baseline, GET by ref)
  // or OSS Git-Diff (working tree vs the committed baseline, POST run).
  const [contractsDiff, setContractsDiff] = useState<api.ContractsDiff | null>(null);
  const [specDiff, setSpecDiff] = useState<api.SpecDiff | null>(null);
  useEffect(() => {
    const ee = prNumber != null && !!refForTabs;
    const oss = !isEe && isDiffMode;
    if (!ee && !oss) {
      setContractsDiff(null);
      setSpecDiff(null);
      return;
    }
    let cancelled = false;
    if (leftTab === 'contracts') {
      (ee ? api.getContractsDiff(repoId, refForTabs!) : api.postContractsDiff(repoId))
        .then((d) => !cancelled && setContractsDiff(d))
        .catch(() => {});
    }
    if (leftTab === 'spec') {
      (ee ? api.getSpecDiff(repoId, refForTabs!) : api.postSpecDiff(repoId))
        .then((d) => !cancelled && setSpecDiff(d))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [repoId, prNumber, refForTabs, leftTab, isEe, isDiffMode]);

  const blDriftDiffMode = prNumber != null || (!isEe && isDiffMode);

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

  // Per-tab header actions (Spec Apply, Contracts Generate, Verify Run) — shared
  // by both the OSS Header and the EE repo chrome.
  // OSS-only Git-Diff toggle for the BL-Drift tabs (EE uses the PR `?pr=` view).
  const blDriftDiffToggle = (verb: string, plural: string) =>
    !isEe && repo?.isGitRepo !== false ? (
      <DiffModeToggle diffMode={isDiffMode} onToggle={setIsDiffMode} subject={{ verb, plural }} />
    ) : null;

  const sectionActionsNode =
    leftTab === 'spec' ? (
      <div className="flex items-center gap-2">
        {blDriftDiffToggle('scans', 'spec changes')}
        <SpecHeaderActions isGitRepo={repo?.isGitRepo !== false} hosted={isEe} />
      </div>
    ) : leftTab === 'contracts' ? (
      <div className="flex items-center gap-2">
        {blDriftDiffToggle('generates', 'contract changes')}
        <ContractsHeaderActions
          isGenerating={contractsGenerating}
          onGenerate={runContractsGenerate}
          stale={contractsStale}
          isGitRepo={repo?.isGitRepo !== false}
        />
      </div>
    ) : leftTab === 'inferred' ? (
      blDriftDiffToggle('infers', 'undocumented decisions')
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
    ) : null;

  return (
    <SpecProvider source={specSource}>
    <div className="flex h-screen flex-col">
      {isEe ? (
        // EE has no working tree, so the git-only actions (Scan / Generate /
        // Verify Run) stay hidden — each self-gates on isGitRepo/supportsRescan.
        // But "Accept all defaults" resolves conflicts server-side (no tree), so
        // we surface the Spec tab's actions, which for hosted renders just that
        // button (the Scan button self-hides).
        <EeRepoChrome
          repoName={repo?.name}
          branch={currentBranch}
          tabs={eeSectionTabs}
          activeTab={leftTab}
          onTabChange={(t) => handleLeftTabChange(t)}
          section={dashboardSection}
          // Land each lens on its FIRST curated tab (Analytics), not the OSS
          // registry default — which would open Spec when switching to Verification.
          onSectionChange={(next) =>
            setDashboardSection(
              next,
              next === 'codequality' ? EE_ANALYSIS_TAB_ORDER[0] : EE_REPO_TAB_ORDER[0],
            )
          }
          prNumber={prNumber}
          prBranch={verifyDiff?.branch ?? null}
          prConclusion={activePrRun?.conclusion}
          actions={leftTab === 'spec' ? sectionActionsNode : undefined}
        />
      ) : (
        <Header
          repoName={repo?.name}
          currentBranch={currentBranch}
          onAnalyze={
            dashboardSection !== 'codequality' || isViewingHistory || repoError || repo?.isGitRepo === false
              ? undefined
              : handleAnalyze
          }
          isAnalyzing={isAnalyzing || isDiffChecking}
          showBack
          backHref="/"
          isDiffMode={isDiffMode}
          onEnterDiffMode={
            dashboardSection !== 'codequality' || isViewingHistory || repo?.isGitRepo === false
              ? undefined
              : handleEnterDiffMode
          }
          onExitDiffMode={
            dashboardSection !== 'codequality' || isViewingHistory || repo?.isGitRepo === false
              ? undefined
              : handleExitDiffMode
          }
          analyses={analyses}
          selectedAnalysisId={selectedAnalysisId}
          onSelectAnalysis={setSelectedAnalysisId}
          currentAnalysisId={graphAnalysisId || (isDiffMode ? undefined : analyses?.[0]?.id)}
          dashboardSection={dashboardSection}
          onDashboardSectionChange={setDashboardSection}
          sectionActions={sectionActionsNode}
        />
      )}

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
      {/* The local-git-repo check is an OSS concept — EE governs connected
          GitHub repos (the gate clones server-side), so it never applies there. */}
      {!isEe && !repoError && repo?.isGitRepo === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 text-xs text-amber-500">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>This directory is not a git repository — analyze, spec scan, contract generation, and verify are unavailable (TrueCourse needs git for commit-anchored baselines, diff, and history).</span>
        </div>
      )}

      {/* Generate result surfaces as a toast (sonner's <Toaster />
          lives at the app root). Render-less side effect — listens
          for new results and emits toasts, no layout impact. */}
      <ContractsGenerateResultToaster result={contractsGenerateResult} />

      {leftTab === 'settings' && prNumber == null ? (
        <RepoSettings repoFullName={repo?.name} />
      ) : (
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: icon rail (hidden in EE) + violations/rules panel */}
        <LeftSidebar
          section={dashboardSection}
          activeTab={leftTab}
          hideRail={isEe}
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
              prDiff={blDriftDiffMode ? specDiff : null}
              diffMode={blDriftDiffMode}
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
              hosted={isEe}
              prDiff={blDriftDiffMode ? contractsDiff : null}
              diffMode={blDriftDiffMode}
            />
          )}
          {leftTab === 'decisions' && (
            <DecisionsPanel
              activeConflictId={activeSpecConflictId}
              onSelectConflict={handleSelectSpecConflict}
              diffMode={blDriftDiffMode}
            />
          )}
          {leftTab === 'inferred' && (
            <InferredPanel
              decisions={inferred.decisions}
              dismissed={inferred.dismissed}
              error={inferred.error}
              activeKey={activeInferredKey}
              onOpen={handleOpenInferred}
              onRestore={inferred.restore}
              diffMode={inferred.diffMode}
            />
          )}
        </LeftSidebar>

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab bar only on tabs where opening items makes sense (Files/Flows/Databases/Spec canonical/Contracts/Verify) */}
          {((leftTab === 'files' || leftTab === 'flows' || leftTab === 'databases') &&
            (openFiles.length > 0 || openFlows.length > 0 || openDatabases.length > 0)) ||
          (leftTab === 'spec' && openCanonicalFiles.length > 0) ||
          (leftTab === 'contracts' && openContractsFiles.length > 0) ||
          (leftTab === 'inferred' && openInferredTabs.length > 0) ? (
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
                    <FileCode2 className="h-3 w-3 shrink-0" />
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
              {/* Inferred decision tabs */}
              {leftTab === 'inferred' && openInferredTabs.map((t) => {
                const isActive = activeInferredKey === t.key;
                return (
                  <div
                    key={t.key}
                    onClick={() => setActiveInferredKey(t.key)}
                    className={`group shrink-0 flex items-center gap-1 px-3 py-1.5 border-r border-border cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                    title={t.key}
                  >
                    <Lightbulb className="h-3 w-3 shrink-0" />
                    <span className={t.pinned ? 'font-medium' : 'italic'}>{t.identity}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseInferred(t.key);
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
            <SpecCanonicalFile filePath={activeCanonicalPath} />
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
                  {/* EE promotes the analytics aside to its own "Analytics" tab,
                      so the Drift view there is just the list + detail. */}
                  {!isEe && (
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
                  )}
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
                      onSetSeverity={isEe ? toggleDriftSeverity : undefined}
                      hosted={isEe}
                    />
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    {activeDrift ? (
                      <VerifyDriftDetail
                        drift={activeDrift}
                        repoId={repoId}
                        onClose={() => handleCloseDrift(activeDrift.id)}
                        githubFileUrl={githubFileUrl}
                        onOpenFile={(filePath, line) => {
                          // Cross-section navigation: switch to Code Analysis
                          // and open the file viewer at the right line.
                          setDashboardSection('codequality');
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
          ) : leftTab === 'driftanalytics' ? (
            // EE-only standalone analytics tab — the same drift charts/stats the
            // OSS Verify view shows in its left aside, here full-width. Display-
            // only (interactive=false): the drift list lives on the Verify tab, so
            // clicking a chart can't filter it — Verify has its own severity filter.
            <div className="h-full w-full overflow-auto">
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
                interactive={false}
                wide
              />
            </div>
          ) : leftTab === 'runs' ? (
            <VerifyRunsPanel
              history={verifyHistory}
              selectedRunId={selectedVerifyRunId}
              onViewRun={handleViewVerifyRun}
              onDeleteRun={handleDeleteVerifyRun}
              hosted={isEe}
            />
          ) : leftTab === 'pulls' ? (
            <PullRequestsView repoFullName={repo?.name} />
          ) : leftTab === 'inferred' ? (
            (() => {
              const active = activeInferredKey
                ? (inferred.decisions ?? []).find((d) => inferredKey(d) === activeInferredKey) ?? null
                : null;
              return active ? (
                <InferredDecisionDetail
                  d={active}
                  busy={inferred.busyKey === activeInferredKey}
                  onAct={handleInferredAct}
                  readOnly={inferred.diffMode}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center text-sm text-muted-foreground">
                  <p className="max-w-sm">
                    Undocumented decisions TrueCourse reverse-engineered from this repo's code. Select
                    one from the list to review its inferred contract, then promote it to the spec or
                    dismiss it.
                  </p>
                </div>
              );
            })()
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
          ) : leftTab === 'home' || leftTab === 'analytics' || leftTab === 'violations' ? (
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
                isDiffMode={isDiffMode || prCodeQuality}
                diffResult={diffResult}
                onLocateNode={handleLocateNodeFromHome}
                onOpenFile={openFile}
                onRefreshAfterDisable={refetchViolations}
                // EE Code Quality splits the OSS combined view: Analytics tab shows
                // the charts only, Violations tab the list only. OSS `home` = both.
                mode={
                  leftTab === 'analytics'
                    ? 'analytics'
                    : leftTab === 'violations'
                      ? 'violations'
                      : 'full'
                }
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
            <div className="flex h-full w-full items-center justify-center p-6">
              <div className="flex max-w-sm flex-col items-center gap-3 text-center">
                <Network className="h-10 w-10 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">
                  {isEe ? 'No analysis yet' : 'No graph data'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isEe
                    ? 'The architecture graph appears here after your default branch is analyzed.'
                    : 'Run an analysis to generate the architecture graph.'}
                </p>
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
                readonly={isEe}
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
      )}

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
