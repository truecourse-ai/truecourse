
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, Navigate } from 'react-router-dom';
import { useRepoUrl, setDetailPatch, clearDetailPatch, CLEAR_ALL_DETAILS } from '@/hooks/useRepoUrl';
import { Loader2, AlertCircle, Wifi, WifiOff, X, Workflow, Database, Check, CircleX } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LeftSidebar, type LeftTab } from '@/components/layout/LeftSidebar';
import { GraphCanvas } from '@/components/graph/GraphCanvas';
import { HomePanel } from '@/components/pages/HomePanel';
import { FileTree } from '@/components/files/FileTree';
import { FlowList } from '@/components/flows/FlowList';
import { FlowDiagramPanel } from '@/components/flows/FlowDiagramPanel';
import { CodeViewerPanel } from '@/components/code/CodeViewerPanel';
import { SchemaPanel } from '@/components/schema/SchemaPanel';
import { DatabaseList } from '@/components/schema/DatabaseList';
import { AnalysesPanel } from '@/components/analyses/AnalysesPanel';
import { DecisionsPanel } from '@/components/decisions/DecisionsPanel';
import { AdrViewerPanel } from '@/components/decisions/AdrViewerPanel';
import { ScrollText } from 'lucide-react';
import type { AdrDraftResponse, AdrListItem } from '@/lib/api';
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
  'home',
  'graphs',
  'files',
  'flows',
  'databases',
  'analyses',
  'decisions',
]);

const MAIN_CONTENT_TABS = new Set<LeftTab>([
  'home',
  'graphs',
  'analyses',
]);

export default function RepoGraphPage() {
  const { repoId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const updateUrl = useRepoUrl();
  const [repo, setRepo] = useState<RepoResponse | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);

  // Map URL terms (functions) ↔ internal terms (methods)
  const urlToDepth: Record<string, DepthLevel> = { services: 'services', modules: 'modules', functions: 'methods' };
  const depthToUrl: Record<DepthLevel, string> = { services: 'services', modules: 'modules', methods: 'functions' };
  const modeFromUrl = searchParams?.get('mode') || '';
  const initialMode = urlToDepth[modeFromUrl] || 'services';
  const [depthLevel, setDepthLevelState] = useState<DepthLevel>(initialMode);

  const [scopedServiceId, setScopedServiceIdState] = useState<string | null>(
    () => searchParams?.get('scopeService') || null,
  );
  const [scopedModuleId, setScopedModuleIdState] = useState<string | null>(
    () => searchParams?.get('scopeModule') || null,
  );

  const setScopedServiceId = useCallback(
    (id: string | null) => {
      setScopedServiceIdState(id);
      updateUrl({ scopeService: id });
    },
    [updateUrl],
  );

  const setScopedModuleId = useCallback(
    (id: string | null) => {
      setScopedModuleIdState(id);
      updateUrl({ scopeModule: id });
    },
    [updateUrl],
  );

  const setDepthLevel = useCallback(
    (level: DepthLevel) => {
      setDepthLevelState(level);
      if (level === 'services') {
        // Services depth doesn't consume scope params — strip from URL
        // but keep them in memory so returning to modules/methods restores
        // the user's last picks.
        updateUrl({ mode: null, scopeService: null, scopeModule: null });
      } else if (level === 'modules') {
        // Modules depth uses `scopeService` but not `scopeModule`.
        updateUrl({
          mode: 'modules',
          scopeService: scopedServiceId,
          scopeModule: null,
        });
      } else {
        // Methods depth: restore both scope params from memory if present.
        updateUrl({
          mode: depthToUrl[level],
          scopeService: scopedServiceId,
          scopeModule: scopedModuleId,
        });
      }
    },
    [updateUrl, scopedServiceId, scopedModuleId],
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [leftTab, setLeftTabState] = useState<LeftTab | null>(() => {
    const tabParam = searchParams?.get('tab');
    // Legacy URL compat: ?tab=violations now maps to the Graphs tab.
    if (tabParam === 'violations') return 'graphs';
    // Legacy URL compat: the Analytics tab was folded into Home.
    if (tabParam === 'analytics') return 'home';
    if (tabParam && VALID_LEFT_TABS.has(tabParam as LeftTab)) {
      return tabParam as LeftTab;
    }
    if (searchParams?.get('flow')) return 'flows';
    if (searchParams?.get('file')) return 'files';
    return 'home';
  });
  const setLeftTab = useCallback(
    (tab: LeftTab | null) => {
      setLeftTabState(tab);
      if (tab && tab !== 'home') {
        updateUrl({ tab });
      } else {
        // Home is the default landing. Strip tab-scoped params so the URL
        // shortens to /repos/:id, but keep `view=diff` — diff mode is a
        // page-level mode that home renders alongside the default view.
        // Detail params (file/flow/adr/draft/db) are cleared via the
        // centralized sentinel so every detail kind is handled here.
        updateUrl({
          tab: null,
          mode: null,
          scopeService: null,
          scopeModule: null,
          [CLEAR_ALL_DETAILS]: true,
        });
      }
    },
    [updateUrl],
  );
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

  const setActiveFilePath = useCallback(
    (path: string | null) => {
      setActiveFilePathState(path);
      updateUrl(path ? setDetailPatch('file', path) : clearDetailPatch('file'));
    },
    [updateUrl],
  );

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

  const setActiveFlowId = useCallback(
    (id: string | null) => {
      setActiveFlowIdState(id);
      updateUrl(id ? setDetailPatch('flow', id) : clearDetailPatch('flow'));
    },
    [updateUrl],
  );

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

  // Multi-tab ADR / draft viewer state. Mirrors openFiles — single-click
  // opens in preview (unpinned, italic; replaces any existing preview slot),
  // double-click pins the tab. Key shape: `draft:<id>` for drafts,
  // `adr:<id>` for accepted ADRs, so the same tab bar can render both.
  type OpenAdr = { key: string; kind: 'adr' | 'draft'; id: string; title: string; pinned: boolean };
  // URL restore: `?adr=<adrId>` or `?draft=<draftId>` — mirrors how files
  // and flows round-trip through the URL so refresh / back+forward / deep
  // links land on the same tab.
  const adrFromUrl = searchParams?.get('adr') ?? null;
  const draftFromUrl = searchParams?.get('draft') ?? null;
  const initialAdrTab: OpenAdr | null = adrFromUrl
    ? { key: `adr:${adrFromUrl}`, kind: 'adr', id: adrFromUrl, title: adrFromUrl, pinned: true }
    : draftFromUrl
      ? { key: `draft:${draftFromUrl}`, kind: 'draft', id: draftFromUrl, title: 'Draft', pinned: true }
      : null;
  const [openAdrs, setOpenAdrs] = useState<OpenAdr[]>(() =>
    initialAdrTab ? [initialAdrTab] : [],
  );
  const [activeAdrKey, setActiveAdrKeyState] = useState<string | null>(
    initialAdrTab?.key ?? null,
  );

  const setActiveAdrKey = useCallback(
    (key: string | null) => {
      setActiveAdrKeyState(key);
      if (!key) {
        // Clear both adr+draft — the caller doesn't tell us which was set.
        // Other detail params (file/flow/db) stay untouched so calling
        // this right after `setActiveFilePath(path)` doesn't wipe `file`.
        updateUrl({ adr: null, draft: null });
        return;
      }
      if (key.startsWith('adr:')) {
        updateUrl(setDetailPatch('adr', key.slice('adr:'.length)));
      } else if (key.startsWith('draft:')) {
        updateUrl(setDetailPatch('draft', key.slice('draft:'.length)));
      }
    },
    [updateUrl],
  );

  /** Core logic shared by handleOpenAdr / handleOpenDraft — matches handleOpenFile. */
  const openAdrTab = useCallback(
    (incoming: Omit<OpenAdr, 'pinned'>, pinned: boolean) => {
      setOpenAdrs((prev) => {
        const existing = prev.find((o) => o.key === incoming.key);
        if (existing) {
          // Already open — OR pinning so double-clicking a preview tab promotes it.
          return prev.map((o) => (o.key === incoming.key ? { ...o, pinned: pinned || o.pinned } : o));
        }
        if (pinned) {
          return [...prev, { ...incoming, pinned: true }];
        }
        // Unpinned: replace any existing preview slot (one preview at a time).
        const hasUnpinned = prev.find((o) => !o.pinned);
        if (hasUnpinned) {
          return prev.map((o) => (!o.pinned ? { ...incoming, pinned: false } : o));
        }
        return [...prev, { ...incoming, pinned: false }];
      });
      // Switch the main area to this ADR — clears other actives + flips
      // leftTab so `showingAdr` becomes true (and the existing sibling
      // `showingX` derivations become false).
      setActiveAdrKey(incoming.key);
      setActiveFilePath(null);
      setActiveFlowId(null);
      setActiveDbId(null);
      setLeftTab('decisions');
    },
    [setActiveFilePath, setActiveFlowId, setActiveDbId, setLeftTab],
  );

  const handleOpenAdr = useCallback(
    (adr: AdrListItem, pinned: boolean) => {
      openAdrTab({ key: `adr:${adr.id}`, kind: 'adr', id: adr.id, title: adr.title }, pinned);
    },
    [openAdrTab],
  );

  const handleOpenDraft = useCallback(
    (draft: AdrDraftResponse, pinned: boolean) => {
      openAdrTab({ key: `draft:${draft.id}`, kind: 'draft', id: draft.id, title: draft.title }, pinned);
    },
    [openAdrTab],
  );

  const handleCloseAdrTab = useCallback((key: string) => {
    setOpenAdrs((prev) => prev.filter((o) => o.key !== key));
    if (activeAdrKey === key) {
      const remaining = openAdrs.filter((o) => o.key !== key);
      setActiveAdrKey(remaining.length > 0 ? remaining[remaining.length - 1].key : null);
    }
  }, [openAdrs, activeAdrKey, setActiveAdrKey]);

  // Bumped after an accept/reject so the Decisions sidebar list refetches —
  // otherwise the list would stay stale until the next socket event.
  const [decisionsRefreshKey, setDecisionsRefreshKey] = useState(0);
  const bumpDecisionsRefresh = useCallback(() => {
    setDecisionsRefreshKey((k) => k + 1);
  }, []);

  // ---------------------------------------------------------------------------
  // Global tab-insertion order across kinds. Composite keys:
  //   `file:<path>`  `flow:<id>`  `db:<id>`  `adr:<id>`  `draft:<id>`
  //
  // Derived from the union of openFiles / openFlows / openDatabases / openAdrs.
  // New keys append at the end; disappeared keys are dropped. The tab bar
  // iterates this order so a file opened AFTER an ADR appears to the right of
  // the ADR, not bunched at the left of a per-kind section.
  // ---------------------------------------------------------------------------
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  useEffect(() => {
    const present = new Set<string>([
      ...openFiles.map((f) => `file:${f.path}`),
      ...openFlows.map((f) => `flow:${f.id}`),
      ...openDatabases.map((d) => `db:${d.id}`),
      ...openAdrs.map((o) => o.key),
    ]);
    setTabOrder((prev) => {
      const kept = prev.filter((k) => present.has(k));
      const appended: string[] = [];
      for (const k of present) {
        if (!prev.includes(k)) appended.push(k);
      }
      if (kept.length === prev.length && appended.length === 0) return prev;
      return [...kept, ...appended];
    });
  }, [openFiles, openFlows, openDatabases, openAdrs]);

  // Auto-activate the last open tab of a kind when re-entering that tab.
  // Example: open ADR-0001 → click Home (URL clears) → click Decisions. The
  // tab chip is still there (`openAdrs` is in-memory state), but the URL
  // sync cleared `activeAdrKey`. Without this, the user lands on an empty
  // Decisions pane with the old tab visible but inert. Same for Files /
  // Flows. Runs only when the kind is the current `leftTab` so closing a
  // tab elsewhere doesn't silently re-activate it in the background.
  useEffect(() => {
    if (leftTab === 'files' && !activeFilePath && openFiles.length > 0) {
      setActiveFilePath(openFiles[openFiles.length - 1].path);
    }
    if (leftTab === 'flows' && !activeFlowId && openFlows.length > 0) {
      setActiveFlowId(openFlows[openFlows.length - 1].id);
    }
    if (leftTab === 'decisions' && !activeAdrKey && openAdrs.length > 0) {
      setActiveAdrKey(openAdrs[openAdrs.length - 1].key);
    }
  }, [
    leftTab,
    openFiles,
    openFlows,
    openAdrs,
    activeFilePath,
    activeFlowId,
    activeAdrKey,
    setActiveFilePath,
    setActiveFlowId,
    setActiveAdrKey,
  ]);

  // Sync React state from the URL on every location change. This covers
  // browser Back / Forward (and deep-linked reloads) — without it, the URL
  // changes but in-memory state stays frozen at whatever the user last set.
  // Setters are idempotent, so running this on our own navigations is a no-op.
  useEffect(() => {
    const urlAdr = searchParams?.get('adr') ?? null;
    const urlDraft = searchParams?.get('draft') ?? null;

    const tabParam = searchParams?.get('tab') ?? null;
    const nextTab: LeftTab =
      tabParam === 'violations'
        ? 'graphs'
        : tabParam === 'analytics'
          ? 'home'
          : tabParam && VALID_LEFT_TABS.has(tabParam as LeftTab)
            ? (tabParam as LeftTab)
            : searchParams?.get('flow')
              ? 'flows'
              : searchParams?.get('file')
                ? 'files'
                : urlAdr || urlDraft
                  ? 'decisions'
                  : 'home';
    setLeftTabState(nextTab);

    const modeParam = searchParams?.get('mode') ?? '';
    setDepthLevelState(urlToDepth[modeParam] ?? 'services');

    setScopedServiceIdState(searchParams?.get('scopeService') ?? null);
    setScopedModuleIdState(searchParams?.get('scopeModule') ?? null);
    setActiveFilePathState(searchParams?.get('file') ?? null);
    setActiveFlowIdState(searchParams?.get('flow') ?? null);
    setActiveAdrKeyState(
      urlAdr ? `adr:${urlAdr}` : urlDraft ? `draft:${urlDraft}` : null,
    );
    setIsDiffModeState(searchParams?.get('view') === 'diff');
  }, [searchParams]);

  const clearActiveDetailView = useCallback(() => {
    setActiveFilePath(null);
    setActiveFlowId(null);
    setActiveDbId(null);
  }, [setActiveFilePath, setActiveFlowId, setActiveDbId]);

  const showFileView = useCallback((path: string | null) => {
    setActiveFilePath(path);
    setActiveFlowId(null);
    setActiveDbId(null);
    setActiveAdrKey(null);
    setLeftTab('files');
  }, [setActiveFilePath, setActiveFlowId, setActiveDbId, setLeftTab]);

  const handleSelectTab = useCallback((path: string | null) => {
    showFileView(path);
  }, [showFileView]);

  const showFlowView = useCallback((flowId: string | null) => {
    setActiveFlowId(flowId);
    setActiveFilePath(null);
    setActiveDbId(null);
    setActiveAdrKey(null);
    setLeftTab('flows');
  }, [setActiveFlowId, setActiveFilePath, setActiveDbId, setLeftTab]);

  const showDatabaseView = useCallback((dbId: string | null) => {
    setActiveDbId(dbId);
    setActiveFilePath(null);
    setActiveFlowId(null);
    setActiveAdrKey(null);
    setLeftTab('databases');
  }, [setActiveDbId, setActiveFilePath, setActiveFlowId, setLeftTab]);

  const showAdrView = useCallback((key: string) => {
    setActiveAdrKey(key);
    setActiveFilePath(null);
    setActiveFlowId(null);
    setActiveDbId(null);
    setLeftTab('decisions');
  }, [setActiveFilePath, setActiveFlowId, setActiveDbId, setLeftTab]);

  // Home is the default + locked tab. Clicking an active rail icon (which the
  // sidebar signals as `null`) falls back to Home instead of nulling out.
  // Active file/flow/db IDs persist across tab switches — their detail views
  // are gated on `leftTab`, so returning to Files/Flows/Databases reopens the
  // last-viewed item.
  const handleLeftTabChange = useCallback((tab: LeftTab | null) => {
    setLeftTab(tab ?? 'home');
  }, [setLeftTab]);

  const handleOpenFlow = useCallback((flowId: string, flowName: string, pinned: boolean) => {
    setOpenFlows((prev) => {
      const existing = prev.find((f) => f.id === flowId);
      if (existing) {
        // Update name too — it may have been 'Flow' placeholder from a URL restore.
        return prev.map((f) => f.id === flowId ? { ...f, name: flowName, pinned: pinned || f.pinned } : f);
      }
      if (pinned) {
        return [...prev, { id: flowId, name: flowName, pinned: true }];
      }
      const hasUnpinned = prev.find((f) => !f.pinned);
      if (hasUnpinned) {
        return prev.map((f) => !f.pinned ? { id: flowId, name: flowName, pinned: false } : f);
      }
      return [...prev, { id: flowId, name: flowName, pinned: false }];
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
  const { isConnected, analysisProgress, clearProgress, onEvent, llmEstimate, respondToLlmEstimate } = useSocket(repoId);
  // Note: graph node clicks store into `selectedService` for visual highlight only —
  // we deliberately don't pass it to useViolations so the violations list is never
  // filtered as a side effect of clicking a graph node.
  const { violations: rawViolations, allViolations: rawAllViolations, isLoading: violationsLoading, refetch: refetchViolations } = useViolations(repoId, undefined, selectedAnalysisId ?? undefined);
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


  const setIsDiffMode = useCallback(
    (diff: boolean) => {
      setIsDiffModeState(diff);
      updateUrl({ view: diff ? 'diff' : null });
    },
    [updateUrl],
  );

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

  const handleLocateNode = useCallback((
    nodeId: string,
    requiredDepth?: string,
    hints?: { serviceId?: string | null; moduleId?: string | null },
  ) => {
    const targetDepth = (requiredDepth ?? depthLevel) as DepthLevel;

    // Derive next scope from hints + target depth. Hints win when provided;
    // otherwise we preserve existing scope (e.g. a repeat Locate on the same service).
    let nextServiceId: string | null = scopedServiceId;
    let nextModuleId: string | null = scopedModuleId;
    if (targetDepth === 'services') {
      nextServiceId = null;
      nextModuleId = null;
    } else if (targetDepth === 'modules') {
      if (hints?.serviceId !== undefined) nextServiceId = hints.serviceId ?? null;
      nextModuleId = null;
    } else {
      if (hints?.serviceId !== undefined) nextServiceId = hints.serviceId ?? null;
      if (hints?.moduleId !== undefined) nextModuleId = hints.moduleId ?? null;
    }

    setDepthLevelState(targetDepth);
    setScopedServiceIdState(nextServiceId);
    setScopedModuleIdState(nextModuleId);

    updateUrl({
      mode: targetDepth === 'services' ? null : depthToUrl[targetDepth],
      scopeService: nextServiceId,
      scopeModule: nextModuleId,
    });

    if (requiredDepth && requiredDepth !== depthLevel) {
      setTimeout(() => setFocusRequest({ nodeId, key: Date.now() }), 500);
    } else {
      setFocusRequest({ nodeId, key: Date.now() });
    }
  }, [depthLevel, scopedServiceId, scopedModuleId, updateUrl]);

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
  const activeAdrTab = openAdrs.find((o) => o.key === activeAdrKey) ?? null;
  const showingAdr = activeAdrTab !== null && leftTab === 'decisions';

  const hasAnalysis = repo?.lastAnalyzed != null;

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
        isAnalyzing={isAnalyzing || isDiffChecking}
        showBack
        backHref="/"
        isDiffMode={isDiffMode}
        onEnterDiffMode={isViewingHistory ? undefined : handleEnterDiffMode}
        onExitDiffMode={isViewingHistory ? undefined : handleExitDiffMode}
        analyses={analyses}
        selectedAnalysisId={selectedAnalysisId}
        onSelectAnalysis={setSelectedAnalysisId}
        currentAnalysisId={graphAnalysisId || (isDiffMode ? undefined : analyses?.[0]?.id)}
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

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: icon rail + violations/rules panel */}
        <LeftSidebar activeTab={leftTab} onTabChange={handleLeftTabChange} badgeCounts={{
          home: allViolations.length,
          flows: flowList.length,
          databases: nodes.filter((n) => n.type === 'database').length,
          analyses: analyses.length,
        }}>
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
          {leftTab === 'decisions' && (
            <DecisionsPanel
              repoId={repoId}
              onOpenAdr={handleOpenAdr}
              onOpenDraft={handleOpenDraft}
              activeTabKey={leftTab === 'decisions' ? activeAdrKey : null}
              refreshKey={decisionsRefreshKey}
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
          {/* Tab bar only on tabs where opening items makes sense */}
          {(leftTab === 'files' || leftTab === 'flows' || leftTab === 'databases' || leftTab === 'decisions') &&
            (openFiles.length > 0 || openFlows.length > 0 || openDatabases.length > 0 || openAdrs.length > 0) && (
            <div className="flex shrink-0 items-center border-b border-border bg-card text-xs overflow-x-auto">
              {/* Unified tab rendering — iterate the global insertion order so
                  tabs interleave across kinds (file → ADR → file lands L→R). */}
              {tabOrder.map((key) => {
                if (key.startsWith('file:')) {
                  const filePath = key.slice('file:'.length);
                  const file = openFiles.find((f) => f.path === filePath);
                  if (!file) return null;
                  const fileName = filePath.split('/').pop() || filePath;
                  const isActive = activeFilePath === filePath && leftTab === 'files';
                  return (
                    <div
                      key={key}
                      onClick={() => handleSelectTab(filePath)}
                      className={`group shrink-0 flex items-center gap-1 px-3 py-1.5 border-r border-border cursor-pointer transition-colors ${isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                      title={filePath}
                    >
                      <span className={file.pinned ? 'font-medium' : 'italic'}>{fileName}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCloseFile(filePath); }}
                        className={`rounded p-0.5 hover:bg-muted transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                }
                if (key.startsWith('flow:')) {
                  const flowId = key.slice('flow:'.length);
                  const flow = openFlows.find((f) => f.id === flowId);
                  if (!flow) return null;
                  const isActive = activeFlowId === flow.id && leftTab === 'flows';
                  return (
                    <div
                      key={key}
                      onClick={() => showFlowView(flow.id)}
                      className={`group shrink-0 flex items-center gap-1 px-3 py-1.5 border-r border-border cursor-pointer transition-colors ${isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                      title={flow.name}
                    >
                      <Workflow className="h-3 w-3 shrink-0" />
                      <span className={flow.pinned ? 'font-medium' : 'italic'}>{flow.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCloseFlow(flow.id); }}
                        className={`rounded p-0.5 hover:bg-muted transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                }
                if (key.startsWith('db:')) {
                  const dbId = key.slice('db:'.length);
                  const db = openDatabases.find((d) => d.id === dbId);
                  if (!db) return null;
                  const isActive = activeDbId === db.id && leftTab === 'databases';
                  return (
                    <div
                      key={key}
                      onClick={() => showDatabaseView(db.id)}
                      className={`group shrink-0 flex items-center gap-1 px-3 py-1.5 border-r border-border cursor-pointer transition-colors ${isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                      title={db.name}
                    >
                      <Database className="h-3 w-3 shrink-0" />
                      <span className={db.pinned ? 'font-medium' : 'italic'}>{db.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCloseDatabase(db.id); }}
                        className={`rounded p-0.5 hover:bg-muted transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                }
                // ADR / draft tabs — keys `adr:<id>` or `draft:<id>`
                const tab = openAdrs.find((o) => o.key === key);
                if (!tab) return null;
                const isActive = activeAdrKey === tab.key && leftTab === 'decisions';
                const label = tab.kind === 'draft' ? tab.title : `${tab.id}: ${tab.title}`;
                return (
                  <div
                    key={key}
                    onClick={() => showAdrView(tab.key)}
                    onDoubleClick={() => {
                      setOpenAdrs((prev) => prev.map((o) => (o.key === tab.key ? { ...o, pinned: true } : o)));
                    }}
                    className={`group shrink-0 flex items-center gap-1 px-3 py-1.5 border-r border-border cursor-pointer transition-colors ${isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                    title={label}
                  >
                    <ScrollText className="h-3 w-3 shrink-0" />
                    <span className={tab.pinned ? 'font-medium' : 'italic'}>{label}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCloseAdrTab(tab.key); }}
                      className={`rounded p-0.5 hover:bg-muted transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

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
          ) : showingAdr && activeAdrTab ? (
            <AdrViewerPanel
              repoId={repoId}
              kind={activeAdrTab.kind}
              id={activeAdrTab.id}
              onDraftResolved={() => {
                handleCloseAdrTab(activeAdrTab.key);
                bumpDecisionsRefresh();
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
                      : leftTab === 'decisions'
                        ? 'Pick an ADR or draft from the list. Or click "Suggest undocumented decisions" to generate drafts from the current code graph.'
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
      {llmEstimate && (
        <div className="fixed bottom-4 left-1/2 z-50 w-80 -translate-x-1/2 rounded-lg border border-border bg-card p-4 shadow-lg">
          <div className="mb-3">
            <span className="text-xs font-medium text-foreground">LLM Analysis</span>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {(() => {
                const totalRules = llmEstimate.estimate.tiers.reduce((s, t) => s + t.ruleCount, 0);
                const totalFiles = llmEstimate.estimate.tiers.reduce((s, t) => s + t.fileCount, 0);
                return `${totalFiles} files, ${totalRules} rules (~${Math.round(llmEstimate.estimate.totalEstimatedTokens / 1000)}k tokens)`;
              })()}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="flex-1 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => respondToLlmEstimate(llmEstimate.repoId, true)}
            >
              Run LLM rules
            </button>
            <button
              className="flex-1 rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent"
              onClick={() => respondToLlmEstimate(llmEstimate.repoId, false)}
            >
              Skip
            </button>
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
    </div>
  );
}
