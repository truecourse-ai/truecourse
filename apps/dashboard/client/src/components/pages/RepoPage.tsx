
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, Wifi, WifiOff, X, Workflow, Database, Check, CircleX, FlaskConical, FlaskConicalOff, PauseCircle, Network } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LeftSidebar, type LeftTab } from '@/components/layout/LeftSidebar';
import { useEdition } from '@/contexts/CapabilityContext';
import { useVisibleTabsForSection } from '@/navigation/registry';
import { EeRepoChrome } from '@/ee/EeRepoChrome';
import { RepoSettings } from '@/ee/RepoSettings';

// EE lens model (curated tab orders + URL-coherence logic) — pure, tested
// on its own in tests/dashboard-client/ee-lens.test.ts.
import {
  EE_ANALYSIS_TAB_ORDER,
  EE_GUARD_TAB_ORDER,
  EE_ANALYSIS_TAB_LABELS,
  eeDefaultTab,
  resolveEeLens,
} from '@/ee/ee-lens';
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
  ViewModeProvider,
  useViewMode,
} from '@/contexts/ViewModeContext';
import { SpecProgressPopup } from '@/components/spec/SpecProgressPopup';
import { useSpecStaleness } from '@/hooks/useSpecStaleness';
import { GraphCanvas } from '@/components/graph/GraphCanvas';
import { HomePanel } from '@/components/pages/HomePanel';
import { FileTree } from '@/components/files/FileTree';
import { FlowList } from '@/components/flows/FlowList';
import { FlowDiagramPanel } from '@/components/flows/FlowDiagramPanel';
import { CodeViewerPanel } from '@/components/code/CodeViewerPanel';
import { SchemaPanel } from '@/components/schema/SchemaPanel';
import { DatabaseList } from '@/components/schema/DatabaseList';
import { AnalysesPanel } from '@/components/analyses/AnalysesPanel';
import { SpecCorpusView, useSpecCorpus } from '@/components/spec/SpecCorpusView';
import { SpecScanButton } from '@/components/spec/SpecScanButton';
import { GuardCoveragePage } from '@/components/guard/GuardCoveragePage';
import { GuardScenariosPanel } from '@/components/guard/GuardScenariosPanel';
import { GuardScenariosOverview } from '@/components/guard/GuardScenariosOverview';
import { GuardScenarioDetail } from '@/components/guard/GuardScenarioDetail';
import { GuardFindingDetail } from '@/components/guard/GuardFindingDetail';
import { GuardHeldDetail } from '@/components/guard/GuardHeldDetail';
import { GuardDriftsView } from '@/components/guard/GuardDriftsView';
import { buildOpenConflictRows, type BlockedConflictRow } from '@/components/guard/GuardBlockedPanel';
import { GuardTabStrip } from '@/components/guard/GuardTabStrip';
import { GuardSectionActions } from '@/components/guard/GuardSectionActions';
import { EmptyState } from '@/components/ui/empty-state';
import { LlmEstimateModal } from '@/components/spec/LlmEstimateModal';
import { useGuardStaleness } from '@/hooks/useGuardStaleness';
import { useGuardReport } from '@/hooks/useGuardReport';
import { useGuardGenerate } from '@/hooks/useGuardGenerate';
import { useGuardRun } from '@/hooks/useGuardRun';
import { useGuardView } from '@/hooks/useGuardView';
import { useGuardCoverageTabs } from '@/hooks/useGuardCoverageTabs';
import { useGuardScenarios } from '@/hooks/useGuardScenarios';
import { useGuardScenarioTabs } from '@/hooks/useGuardScenarioTabs';
import { useGuardDecisions } from '@/hooks/useGuardDecisions';
import { buildAutoResolvedRows, buildFindingRows, buildHeldRows, buildListRows, dismissedKeySet } from '@/lib/guard-list-rows';
import { sectionLeaf } from '@/lib/guard-drifts';
import { useGraph } from '@/hooks/useGraph';
import { useRepoGateRuns } from '@/ee/useRepoGateRuns';
import { resolvePrGuardScope, guardReadsEnabled as canReadGuard } from '@/ee/pr-guard-scope';
import { GuardPrScopeGate } from '@/ee/GuardPrScopeGate';
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
import type { Node } from '@xyflow/react';

// Outer shell: mounts the navigation context (top-level section +
// active left tab, kept in sync with the URL) so the page body and
// every panel read/write it through `useNavigation()` instead of
// having it prop-drilled out of one giant component.
export default function RepoPage() {
  return (
    <NavigationProvider>
      <GraphViewProvider>
        <OpenTabsProvider>
          <ViewModeProvider>
            <RepoPageInner />
          </ViewModeProvider>
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

  const currentBranch = repo?.defaultBranch;

  // Enterprise shows ONLY Code Quality on the repo page (no left rail), as a
  // curated horizontal tab bar. Analytics leads and is the default.
  const isEe = useEdition() === 'enterprise';
  // PR view (EE): `?pr=N` re-scopes the page to a pull request — the code
  // quality view shows the gate's stored PR violation diff. Resolved from the
  // repo's gate runs (latest run per PR).
  const [searchParams] = useSearchParams();
  const prParam = searchParams.get('pr');
  const prNumber = isEe && prParam && /^\d+$/.test(prParam) ? Number(prParam) : null;
  const { runs: gateRuns, loaded: gateRunsLoaded } = useRepoGateRuns(isEe ? repo?.name : undefined);
  const activePrRun = prNumber != null ? gateRuns.find((r) => r.prNumber === prNumber) ?? null : null;
  // Re-keys the PR-scoped views to the PR head (undefined → default branch).
  const refForTabs = prNumber != null ? activePrRun?.headSha : undefined;
  // What a PR-scoped GUARD view may read. While the head SHA is unknown (`?pr=N`
  // with the gate-runs fetch in flight, or a PR with no recorded gate run) every
  // guard read must HOLD: a ref-less guard fetch answers with repo-BASELINE data,
  // which must never render (nor accept dismissals) under a PR header.
  const prGuardScope = resolvePrGuardScope({
    prNumber,
    headSha: activePrRun?.headSha,
    gateRunsLoaded,
  });
  const guardReadsEnabled = canReadGuard(prGuardScope);
  // Code Quality (analysis) tabs — capability gating already drops Flows/Files/
  // Databases in EE (no `local-filesystem`). Curate order + relabel for EE.
  const analysisVisible = useVisibleTabsForSection('codequality');
  const navigate = useNavigate();
  // Guard tabs — OSS/ungated, so the visible set IS the curated set; the map
  // keeps the curated order authoritative should gating ever appear.
  const guardVisible = useVisibleTabsForSection('guard');
  const guardTabs = EE_GUARD_TAB_ORDER.map((id) => guardVisible.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  const analysisTabs = EE_ANALYSIS_TAB_ORDER
    .map((id) => analysisVisible.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    // Settings is repo-wide config — hide it while viewing a PR.
    .filter((t) => !(prNumber != null && t.id === 'settings'))
    .map((t) => ({ ...t, label: EE_ANALYSIS_TAB_LABELS[t.id] ?? t.label }));
  // The tab bar shown for the active EE section.
  const eeSectionTabs = dashboardSection === 'guard' ? guardTabs : analysisTabs;
  useEffect(() => {
    if (!isEe) return;
    // Keep EE in a coherent state: one of the lenses — Code Quality (analysis)
    // or Guard (spec-scenario coverage) — each with its own curated tab set.
    // Keyed off the EXPLICIT ?section param so the default (no param) lands on
    // Code Quality. Decision logic lives in `resolveEeLens`.
    const url = new URL(window.location.href);
    const target = resolveEeLens({ searchParams: url.searchParams, prNumber, leftTab });
    if (!target) return;
    url.searchParams.set('section', target.section);
    url.searchParams.set('tab', target.tab);
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

  const {
    decisionsPending,
    docsChanged,
    refetch: refetchStaleness,
  } = useSpecStaleness(repoId);
  const {
    staleness: guardStaleness,
    loaded: guardStaleLoaded,
    refetch: refetchGuardStaleness,
  } = useGuardStaleness(repoId, refForTabs, guardReadsEnabled);
  // Bumped on a guard-generate / guard-run completion so the page-level report and
  // the child views (coverage / scenarios / runs) refetch — the guard analog of the
  // spec:complete refresh (the views own their own data hooks, so they take this as
  // a reload signal rather than being refetched imperatively).
  const [guardReloadKey, setGuardReloadKey] = useState(0);
  // The last-generate report feeds the Scenarios overview's "last generate"
  // strip, which auto-expands when it carries birth findings or errors.
  const { report: guardReport } = useGuardReport(
    repoId,
    dashboardSection === 'guard' && guardReadsEnabled,
    guardReloadKey,
    refForTabs,
  );
  // Birth generation ended `open-conflicts`: the spec corpus still carries
  // unresolved disagreements, so no scenarios/runs exist. The Scenarios tab shows
  // the blocked panel (live conflict list) and the Runs tab a blocked note.
  const guardBlocked = guardReport?.status === 'open-conflicts';
  // UI-triggered guard actions: Generate (Scenarios tab, estimate-gated) and Run
  // (Drifts tab, deterministic). Held at page level so the in-flight state survives
  // tab switches, exactly like specCorpus / contractsGenerating.
  const guardGen = useGuardGenerate(repoId);
  const guardRun = useGuardRun(repoId);
  // The bidirectional jump from a guard drift / scenario / finding into the
  // coverage tab (a section, a specific conflict, or the tab itself).
  const { openSpecSection, openSpecConflict } = useGuardView();
  // Guard's OWN coverage tab set (`?guard` docs + `?gconf` conflicts + the
  // within-doc `?gsec` section) — the shared preview/pin tab model, kept separate
  // from BL Drift's `?spec`/DriftViewContext so the two never bleed. The coverage
  // sidebar (reused SpecCorpusView) and the main pane share this ONE reducer.
  const guardCoverageTabs = useGuardCoverageTabs(repoId);
  // Scenarios-tab data, hoisted here (like contractsTree/verifyState) so the left
  // panel and the main pane read ONE fetch and the guard reload key refreshes both.
  const guardScenarios = useGuardScenarios(
    repoId,
    leftTab === 'scenarios' && guardReadsEnabled,
    guardReloadKey,
    refForTabs,
  );
  // Guard's OWN scenario tab set (`?gscn=`) — the Spec-doc transient/pinned tab
  // model (single-click preview, double-click pin), guard-scoped so nothing
  // bleeds into BL Drift's DriftViewContext tab sets.
  const guardScenarioTabs = useGuardScenarioTabs(repoId);
  // The committable dismissals (`scenarios/decisions.json`) — a finding the user
  // dismissed still lists here until the next generate (the report is a snapshot),
  // so the rows/detail derive their "dismissed" state from this, not the report.
  const { decisions: guardDecisions, refetch: refetchGuardDecisions } = useGuardDecisions(
    repoId,
    leftTab === 'scenarios' && guardReadsEnabled,
    guardReloadKey,
    prNumber ?? undefined,
  );
  const guardDismissedKeys = useMemo(
    () => dismissedKeySet(guardDecisions.dismissedClaims),
    [guardDecisions],
  );
  // Birth findings live in the SAME left-panel list as committed scenarios (the
  // plan: they are section-bound artifacts that failed to become guards). Lifted
  // from the last-generate report + joined to the committed rows so their group
  // headings resolve the same way scenario rows do; each row carries whether its
  // claim is already dismissed.
  const guardFindingRows = useMemo(
    () => buildFindingRows(guardReport, guardScenarios.rows, guardDismissedKeys),
    [guardReport, guardScenarios.rows, guardDismissedKeys],
  );
  // Ready-but-held scenarios (birth-passed, section withheld) join the SAME left
  // list as scenarios + findings — a first-class block between them.
  const guardHeldRows = useMemo(
    () => buildHeldRows(guardReport, guardScenarios.rows),
    [guardReport, guardScenarios.rows],
  );
  const guardListRows = useMemo(
    () => buildListRows(guardScenarios.rows, guardFindingRows, guardHeldRows),
    [guardScenarios.rows, guardFindingRows, guardHeldRows],
  );
  // The auto-resolved ledger (item 13) — high-confidence weak scenarios the tool
  // discarded + re-authored itself — renders as a collapsed group at the list bottom.
  const guardAutoResolvedRows = useMemo(
    () => buildAutoResolvedRows(guardReport, guardScenarios.rows),
    [guardReport, guardScenarios.rows],
  );

  // Switching to a data tab re-fetches its data, so the panel reflects the latest
  // server state without a full page reload. These hooks live at page level (they
  // survive tab switches), so otherwise they only fetch on mount / socket events.
  // A ref holds the latest refetchers so the effect depends ONLY on `leftTab` —
  // it fires on a tab change, never on a refetcher's identity (so no refetch loop).
  // Cheap reads only; we deliberately don't trigger a re-scan here.
  const tabRefetchersRef = useRef({ refetchStaleness, refetchGuardStaleness });
  tabRefetchersRef.current = { refetchStaleness, refetchGuardStaleness };
  useEffect(() => {
    const r = tabRefetchersRef.current;
    if (
      leftTab === 'coverage' ||
      leftTab === 'scenarios' ||
      leftTab === 'guarddrifts'
    ) {
      void r.refetchGuardStaleness();
    }
  }, [leftTab]);
  // GitHub blob deep-link for a violation's file/line — used by `openFile` in the
  // EE / PR context (the local code viewer isn't reachable there). `repo?.name` is
  // the GitHub owner/repo slug for connected EE repos; the commit is the PR head
  // SHA in PR mode, else the default branch. Returns null (→ in-app onOpenFile
  // fallback) for local/OSS repos with no GitHub remote or when no commit is known.
  const githubFileUrl = useCallback(
    (path: string, lineStart?: number | null, lineEnd?: number | null): string | null => {
      const repoFullName = isEe ? repo?.name : undefined;
      // The PR head SHA in PR mode; else the default branch (baseline is analyzed on it).
      const ref = refForTabs ?? (isEe ? repo?.defaultBranch : undefined);
      if (!repoFullName || !ref || !path) return null;
      // Only a repo-relative path forms a valid blob URL. Pre-fix snapshots stored
      // an absolute clone path (/tmp/tc-gate-verify-…); fall back rather than emit a
      // broken link (a re-verify now rewrites stored paths repo-relative).
      if (path.startsWith('/')) return null;
      // A spec origin can be an external doc URL (e.g. a workspace Confluence page),
      // not a repo file — never splice that into a blob path. The caller links it
      // directly instead.
      if (/^[a-z][\w+.-]*:\/\//i.test(path)) return null;
      // Generated spec artifacts (corpus.json / decisions.json) and synced workspace
      // KB docs (knowledge/<connector>/…) are not committed repo files, so emit no
      // link (plain text) rather than a 404.
      if (/(^|\/)(corpus|decisions)\.json(#|$)/i.test(path)) return null;
      if (path.startsWith('.truecourse/') || path.startsWith('knowledge/')) return null;
      const segments = path.split('/').map((s) => encodeURIComponent(s)).join('/');
      let url = `https://github.com/${repoFullName}/blob/${ref}/${segments}`;
      if (lineStart != null) {
        url += `#L${lineStart}`;
        if (lineEnd != null && lineEnd !== lineStart) url += `-L${lineEnd}`;
      }
      return url;
    },
    [isEe, repo?.name, repo?.defaultBranch, refForTabs],
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

  // Refresh guard/spec staleness after a Scan / guard-generate / guard-run. The
  // server emits `spec:complete` with a kind — the corpus Scan updates its view
  // directly via the GET, but can flip staleness dots.
  useEffect(() => {
    const unsub = onEvent('spec:complete', (data) => {
      const payload = data as
        | { kind?: 'scan' | 'guard-generate' | 'guard-run' }
        | undefined;
      // A scan rewrites the corpus — refresh the spec staleness dot.
      if (payload?.kind === 'scan') {
        refetchStaleness();
        // A scan can also flip the Guard generate-stale dot (specs changed since
        // the last guard generate) — keep the Coverage tab's staleness in sync.
        refetchGuardStaleness();
      }
      // A guard generate wrote scenarios + a report; a guard run wrote a new run.
      // Both flip guard staleness and must refresh the guard read surfaces —
      // refetch the page-level staleness/report and bump the reload key so the
      // child views (coverage / scenarios / runs) re-fetch their data.
      if (payload?.kind === 'guard-generate' || payload?.kind === 'guard-run') {
        refetchGuardStaleness();
        setGuardReloadKey((k) => k + 1);
      }
    });
    return unsub;
  }, [onEvent, refetchStaleness, refetchGuardStaleness]);

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

  const hasAnalysis = repo?.lastAnalyzed != null;

  // Update flow names when flow list loads
  useEffect(() => {
    syncFlowNames(flowList);
  }, [flowList, syncFlowNames]);

  // Corpus-path state — owns the corpus fetch + Scan so the header (not the
  // panel) drives it. Read by the Guard Coverage doc picker AND, when generation
  // is blocked on conflicts, by the Scenarios-tab blocked panel — so the corpus is
  // also fetched on the Scenarios tab in that (only that) state, to list the open
  // conflicts LIVE. No extra call in the common (not-blocked) case.
  const specCorpus = useSpecCorpus(
    repoId,
    (leftTab === 'coverage' || (leftTab === 'scenarios' && guardBlocked)) && guardReadsEnabled,
    refForTabs,
    prNumber ?? undefined,
  );
  // The LIVE open conflicts for the Scenarios-tab blocked panel: `null` while the
  // corpus is still loading (panel spins), else the unresolved subset derived from
  // the corpus (drops instantly when one is resolved on the Coverage tab).
  const guardOpenConflicts = useMemo<BlockedConflictRow[] | null>(
    () => (guardBlocked ? (specCorpus.data ? buildOpenConflictRows(specCorpus.data) : null) : []),
    [guardBlocked, specCorpus.data],
  );

  // Per-tab header actions — shared by both the OSS Header and the EE repo chrome.
  const sectionActionsNode =
    leftTab === 'coverage' ? (
      // The Guard Coverage tab owns the curated corpus: the header owns
      // Scan/Rescan, which curates the docs into areas and flags overlaps.
      // Hidden in EE — hosted repos have no working tree and
      // re-scan automatically on merge / when a PR is opened.
      !isEe && repo?.isGitRepo !== false ? (
        <SpecScanButton
          hasCorpus={specCorpus.data != null}
          scanning={specCorpus.scanning}
          decisionsPending={decisionsPending}
          docsChanged={docsChanged}
          onClick={() => void specCorpus.scan()}
        />
      ) : null
    ) : leftTab === 'scenarios' ? (
      // Generate lives where its output lives — the Scenarios tab. Capability-
      // gated: OSS (`local-filesystem`) opens the estimate modal then runs
      // against the working tree; hosted repos self-drive (auto-generate off a
      // conflict-free scan), so the manual trigger is hidden there.
      <GuardSectionActions
        kind="generate"
        onClick={guardGen.begin}
        busy={guardGen.busy}
        otherBusy={guardRun.running}
        stale={guardStaleness.generateStale}
      />
    ) : leftTab === 'guarddrifts' ? (
      // Run lives on the Drifts tab (it produces the results shown there).
      // Deterministic — no estimate; disabled while a generate is in flight.
      // Local-only: hosted has no manual Run (it happens on the job queue).
      <GuardSectionActions
        kind="run"
        onClick={guardRun.run}
        busy={guardRun.running}
        otherBusy={guardGen.busy}
        stale={guardStaleness.runStale}
      />
    ) : null;

  return (
    <div className="flex h-screen flex-col">
      {isEe ? (
        // EE has no working tree, so the git-only actions stay hidden — each
        // self-gates on isGitRepo. The lens switch flips Code Quality ↔ Guard.
        <EeRepoChrome
          repoName={repo?.name}
          branch={currentBranch}
          tabs={eeSectionTabs}
          activeTab={leftTab}
          onTabChange={(t) => handleLeftTabChange(t)}
          section={dashboardSection}
          // Land each lens on its FIRST curated tab (Analytics for Code Quality,
          // Coverage for Guard), not the OSS registry default.
          onSectionChange={(next) => setDashboardSection(next, eeDefaultTab(next))}
          prNumber={prNumber}
          prBranch={null}
          prConclusion={activePrRun?.conclusion}
          // Guard tabs pass through too: their actions self-gate on capabilities
          // (hosted renders the job-backed Generate, or nothing at all).
          actions={
            leftTab === 'coverage' || leftTab === 'scenarios' || leftTab === 'guarddrifts'
              ? sectionActionsNode
              : undefined
          }
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
          <span>This directory is not a git repository — analyze and spec scan are unavailable (TrueCourse needs git for commit-anchored baselines, diff, and history).</span>
        </div>
      )}

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
          {leftTab === 'coverage' && (
            // Guard Coverage's corpus sidebar (docs + area-tag filter +
            // open/resolved conflicts + skipped/force-in/excluded docs): a doc
            // opens the coverage surface (`?guard`), a conflict opens the
            // resolution detail (`?gconf`).
            <GuardPrScopeGate scope={prGuardScope}>
              <SpecCorpusView
                repoId={repoId}
                corpus={specCorpus}
                activeKey={guardCoverageTabs.activeId}
                onOpen={guardCoverageTabs.open}
                onDecision={refetchStaleness}
              />
            </GuardPrScopeGate>
          )}
          {leftTab === 'scenarios' && (
            // The committed-scenario inventory as a doc › section grouped list
            // with the search/doc/status filters on top. Single-click previews a
            // scenario in the main pane (transient tab), double-click pins it.
            <GuardPrScopeGate scope={prGuardScope}>
              <GuardScenariosPanel
                rows={guardListRows}
                autoResolved={guardAutoResolvedRows}
                loading={guardScenarios.loading}
                error={guardScenarios.error}
                activeId={guardScenarioTabs.activeId}
                onOpen={guardScenarioTabs.open}
                prRef={refForTabs}
                scenariosCommit={guardScenarios.scenariosCommit}
              />
            </GuardPrScopeGate>
          )}
        </LeftSidebar>

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab bar only on tabs where opening items makes sense (Files/Flows/Databases).
              Scenarios/Runs render their own GuardTabStrip (permanent Overview tab), not this shared bar. */}
          {(leftTab === 'files' || leftTab === 'flows' || leftTab === 'databases') &&
            (openFiles.length > 0 || openFlows.length > 0 || openDatabases.length > 0) ? (
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
          ) : leftTab === 'coverage' ? (
            <GuardPrScopeGate scope={prGuardScope}>
              <GuardCoveragePage
                repoId={repoId}
                corpus={specCorpus}
                staleness={guardStaleness}
                staleLoaded={guardStaleLoaded}
                prNumber={prNumber}
                prRef={refForTabs}
                reloadKey={guardReloadKey}
                tabs={guardCoverageTabs}
                onDecision={refetchStaleness}
              />
            </GuardPrScopeGate>
          ) : leftTab === 'scenarios' ? (
            // Guard Scenarios: the shared GuardTabStrip (permanent Overview tab +
            // any opened scenarios, `?gscn=`) over the scenario detail / overview.
            <GuardPrScopeGate scope={prGuardScope}>
              <div className="flex h-full flex-col overflow-hidden">
                <GuardTabStrip
                  tabs={guardScenarioTabs.openTabs.map((t) => {
                    // Tabs label by HUMAN title (truncated); the machine handle (a
                    // scenario id, a finding's binding) rides the hover. Findings take
                    // a distinct glyph so a tab reads as a finding, not a scenario.
                    const scenario = guardScenarios.rows.find((r) => r.id === t.id);
                    if (scenario) return { ...t, label: scenario.title, title: scenario.id };
                    const finding = guardFindingRows.find((r) => r.id === t.id);
                    if (finding) {
                      return {
                        ...t,
                        label: finding.title,
                        title: `${finding.doc} · ${finding.headingText ?? sectionLeaf(finding.anchor)}`,
                        icon: FlaskConicalOff,
                      };
                    }
                    const held = guardHeldRows.find((r) => r.id === t.id);
                    if (held) {
                      return {
                        ...t,
                        label: held.title,
                        title: `${held.doc} · ${held.headingText ?? sectionLeaf(held.anchor)}`,
                        icon: PauseCircle,
                      };
                    }
                    return { ...t, label: t.id, title: t.id };
                  })}
                  activeId={guardScenarioTabs.activeId}
                  onSelect={(t) => guardScenarioTabs.open(t.id, t.pinned)}
                  onSelectOverview={guardScenarioTabs.selectOverview}
                  onClose={guardScenarioTabs.close}
                />
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  {(() => {
                    // A scenario tab shows the full detail; a finding tab shows the
                    // finding detail; nothing open → the overview (recipe + last generate).
                    const activeScenario = guardScenarioTabs.activeId
                      ? guardScenarios.rows.find((r) => r.id === guardScenarioTabs.activeId) ?? null
                      : null;
                    if (activeScenario) {
                      return (
                        <GuardScenarioDetail
                          key={activeScenario.id}
                          repoId={repoId}
                          row={activeScenario}
                          runId={guardScenarios.runId}
                          onClose={() => guardScenarioTabs.close(activeScenario.id)}
                          onOpenSpec={openSpecSection}
                        />
                      );
                    }
                    const activeFinding = guardScenarioTabs.activeId
                      ? guardFindingRows.find((r) => r.id === guardScenarioTabs.activeId) ?? null
                      : null;
                    if (activeFinding) {
                      return (
                        <GuardFindingDetail
                          key={activeFinding.id}
                          repoId={repoId}
                          row={activeFinding}
                          onClose={() => guardScenarioTabs.close(activeFinding.id)}
                          onOpenSpec={openSpecSection}
                          onDismiss={async (claim) => {
                            // Unreachable while the PR scope is unresolved (the pane is
                            // gated), but never write a PR-overlay decision against
                            // findings the user could only have seen on the baseline.
                            if (!guardReadsEnabled) return;
                            await api.dismissGuardClaim(repoId, claim, prNumber ?? undefined);
                            refetchGuardDecisions();
                          }}
                          onUndismiss={async (claim) => {
                            if (!guardReadsEnabled) return;
                            await api.undismissGuardClaim(repoId, claim, prNumber ?? undefined);
                            refetchGuardDecisions();
                          }}
                        />
                      );
                    }
                    const activeHeld = guardScenarioTabs.activeId
                      ? guardHeldRows.find((r) => r.id === guardScenarioTabs.activeId) ?? null
                      : null;
                    if (activeHeld) {
                      return (
                        <GuardHeldDetail
                          key={activeHeld.id}
                          row={activeHeld}
                          onClose={() => guardScenarioTabs.close(activeHeld.id)}
                          onOpenSpec={openSpecSection}
                          onOpenFinding={(findingId) => guardScenarioTabs.open(findingId, false)}
                        />
                      );
                    }
                    if (guardScenarioTabs.activeId) {
                      // A deep link / stale tab pointing at an id the committed corpus
                      // no longer has (or that is still loading).
                      return guardScenarios.loading ? (
                        <div className="flex h-full w-full items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <EmptyState
                          icon={FlaskConical}
                          title="Scenario not found"
                          body="This scenario is not in the committed corpus — it may have been removed or regenerated under a new id."
                        />
                      );
                    }
                    return (
                      <GuardScenariosOverview
                        recipe={guardScenarios.recipe}
                        report={guardReport}
                        scenarioRows={guardScenarios.rows}
                        hasScenarios={guardScenarios.rows.length > 0}
                        loading={guardScenarios.loading}
                        error={guardScenarios.error}
                        onOpenSpec={openSpecSection}
                        // When the report is `open-conflicts`, the overview renders
                        // the blocked panel over these live conflicts instead.
                        conflicts={guardOpenConflicts}
                        onOpenConflict={openSpecConflict}
                      />
                    );
                  })()}
                </div>
              </div>
            </GuardPrScopeGate>
          ) : leftTab === 'guarddrifts' ? (
            <GuardPrScopeGate scope={prGuardScope}>
              <GuardDriftsView
                repoId={repoId}
                reloadKey={guardReloadKey}
                prRef={refForTabs}
                prNumber={prNumber ?? undefined}
                blockedOnConflicts={guardBlocked}
              />
            </GuardPrScopeGate>
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
      {/* The scan / analyze estimate gate — pushed over the socket, confirmed back
          over the socket. */}
      {llmEstimate && (
        <LlmEstimateModal
          estimate={llmEstimate.estimate}
          onConfirm={() => respondToLlmEstimate(llmEstimate.repoId, true)}
          onCancel={() => respondToLlmEstimate(llmEstimate.repoId, false)}
        />
      )}
      {/* The guard Generate estimate gate — fetched via GET, confirmed → POST. Same
          modal, same numbers as the CLI. */}
      {guardGen.modalOpen && guardGen.estimate && (
        <LlmEstimateModal
          estimate={guardGen.estimate}
          onConfirm={guardGen.confirm}
          onCancel={guardGen.cancel}
          modeChoice={{
            mode: guardGen.mode,
            canChoose: guardGen.canChooseMode,
            onChange: guardGen.setMode,
            busy: guardGen.busy,
          }}
        />
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
  );
}
