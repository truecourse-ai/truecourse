/**
 * Open-tabs state for the three editor-style viewers in the analysis
 * section: Files, Flows, and Databases. Each keeps a list of open tabs
 * (pinned / transient) plus the active id; Files and Flows mirror the
 * active id to the URL (?file / ?flow). Opening or switching a viewer
 * also flips the left rail to the owning tab, so this context consumes
 * NavigationContext for `setLeftTab` — it must be mounted under
 * <NavigationProvider>.
 *
 * Lifted out of RepoPage so the file tree, flow list, database list,
 * the tab strip, and the main content pane all share one source of
 * truth instead of threading a dozen handlers through props.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useNavigation } from '@/contexts/NavigationContext';

export type OpenFile = { path: string; pinned: boolean; scrollToLine?: number };
export type OpenFlow = { id: string; name: string; pinned: boolean };
export type OpenDatabase = { id: string; name: string; pinned: boolean };

export interface OpenTabsContextValue {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  setActiveFilePath: (path: string | null) => void;
  handleOpenFile: (path: string, pinned: boolean, scrollToLine?: number) => void;
  handleCloseFile: (path: string) => void;

  openFlows: OpenFlow[];
  activeFlowId: string | null;
  setActiveFlowId: (id: string | null) => void;
  handleOpenFlow: (flowId: string, flowName: string, pinned: boolean) => void;
  handleCloseFlow: (flowId: string) => void;
  /** Refresh open-flow tab names once the flow list loads (URL restores
   *  open a flow with a 'Flow' placeholder name). */
  syncFlowNames: (flows: Array<{ id: string; name: string }>) => void;

  openDatabases: OpenDatabase[];
  activeDbId: string | null;
  setActiveDbId: (id: string | null) => void;
  handleOpenDatabase: (dbId: string, dbName: string, pinned: boolean) => void;
  handleCloseDatabase: (dbId: string) => void;

  /** Clear every active detail view (file/flow/db) without touching tabs. */
  clearActiveDetailView: () => void;
  /** Show a file in the main pane (clears flow/db, flips to Files tab). */
  showFileView: (path: string | null) => void;
  /** Alias kept for the tab strip's click handler. */
  handleSelectTab: (path: string | null) => void;
  showFlowView: (flowId: string | null) => void;
  showDatabaseView: (dbId: string | null) => void;
  /**
   * Left-rail tab change handler: flips the tab and, when entering an
   * empty Files/Flows/Databases tab, reopens the last-viewed item.
   */
  handleLeftTabChange: (tab: string | null) => void;
}

const OpenTabsContext = createContext<OpenTabsContextValue | null>(null);

export function OpenTabsProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setLeftTab } = useNavigation();

  // --- Files -------------------------------------------------------
  const fileFromUrl = searchParams?.get('file') || null;
  const [openFiles, setOpenFiles] = useState<OpenFile[]>(() =>
    fileFromUrl ? [{ path: fileFromUrl, pinned: true }] : [],
  );
  const [activeFilePath, setActiveFilePathState] = useState<string | null>(
    fileFromUrl,
  );

  const setActiveFilePath = useCallback(
    (path: string | null) => {
      setActiveFilePathState(path);
      const url = new URL(window.location.href);
      if (path) url.searchParams.set('file', path);
      else url.searchParams.delete('file');
      navigate(url.pathname + url.search);
    },
    [navigate],
  );

  const handleOpenFile = useCallback(
    (path: string, pinned: boolean, scrollToLine?: number) => {
      setOpenFiles((prev) => {
        const existing = prev.find((f) => f.path === path);
        if (existing) {
          return prev.map((f) =>
            f.path === path
              ? {
                  ...f,
                  pinned: pinned || f.pinned,
                  scrollToLine: scrollToLine ?? f.scrollToLine,
                }
              : f,
          );
        }
        if (pinned) return [...prev, { path, pinned: true, scrollToLine }];
        const hasUnpinned = prev.find((f) => !f.pinned);
        if (hasUnpinned) {
          return prev.map((f) =>
            !f.pinned ? { path, pinned: false, scrollToLine } : f,
          );
        }
        return [...prev, { path, pinned: false, scrollToLine }];
      });
      setActiveFilePath(path);
      setLeftTab('files');
    },
    [setActiveFilePath, setLeftTab],
  );

  const handleCloseFile = useCallback(
    (path: string) => {
      setOpenFiles((prev) => prev.filter((f) => f.path !== path));
      if (activeFilePath === path) {
        const remaining = openFiles.filter((f) => f.path !== path);
        setActiveFilePath(
          remaining.length > 0 ? remaining[remaining.length - 1].path : null,
        );
      }
    },
    [openFiles, activeFilePath, setActiveFilePath],
  );

  // --- Flows -------------------------------------------------------
  const flowFromUrl = searchParams?.get('flow') || null;
  const [openFlows, setOpenFlows] = useState<OpenFlow[]>(() =>
    flowFromUrl ? [{ id: flowFromUrl, name: 'Flow', pinned: true }] : [],
  );
  const [activeFlowId, setActiveFlowIdState] = useState<string | null>(
    flowFromUrl,
  );

  const setActiveFlowId = useCallback(
    (id: string | null) => {
      setActiveFlowIdState(id);
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set('flow', id);
        url.searchParams.delete('file');
      } else {
        url.searchParams.delete('flow');
      }
      navigate(url.pathname + url.search);
    },
    [navigate],
  );

  const handleCloseFlow = useCallback(
    (flowId: string) => {
      setOpenFlows((prev) => prev.filter((f) => f.id !== flowId));
      if (activeFlowId === flowId) {
        const remaining = openFlows.filter((f) => f.id !== flowId);
        setActiveFlowId(
          remaining.length > 0 ? remaining[remaining.length - 1].id : null,
        );
      }
    },
    [openFlows, activeFlowId, setActiveFlowId],
  );

  const syncFlowNames = useCallback(
    (flows: Array<{ id: string; name: string }>) => {
      if (flows.length === 0) return;
      setOpenFlows((prev) =>
        prev.map((f) => {
          const match = flows.find((fl) => fl.id === f.id);
          return match ? { ...f, name: match.name } : f;
        }),
      );
    },
    [],
  );

  // --- Databases ---------------------------------------------------
  const [openDatabases, setOpenDatabases] = useState<OpenDatabase[]>([]);
  const [activeDbId, setActiveDbIdState] = useState<string | null>(null);
  const setActiveDbId = useCallback((id: string | null) => {
    setActiveDbIdState(id);
  }, []);

  const handleCloseDatabase = useCallback(
    (dbId: string) => {
      setOpenDatabases((prev) => prev.filter((d) => d.id !== dbId));
      if (activeDbId === dbId) {
        const remaining = openDatabases.filter((d) => d.id !== dbId);
        setActiveDbId(
          remaining.length > 0 ? remaining[remaining.length - 1].id : null,
        );
      }
    },
    [openDatabases, activeDbId, setActiveDbId],
  );

  // --- Cross-viewer orchestration ----------------------------------
  const clearActiveDetailView = useCallback(() => {
    setActiveFilePath(null);
    setActiveFlowId(null);
    setActiveDbId(null);
  }, [setActiveFilePath, setActiveFlowId, setActiveDbId]);

  const showFileView = useCallback(
    (path: string | null) => {
      setActiveFilePath(path);
      setActiveFlowId(null);
      setActiveDbId(null);
      if (path !== null) setLeftTab('files');
    },
    [setActiveFilePath, setActiveFlowId, setActiveDbId, setLeftTab],
  );

  const handleSelectTab = useCallback(
    (path: string | null) => {
      showFileView(path);
    },
    [showFileView],
  );

  const showFlowView = useCallback(
    (flowId: string | null) => {
      setActiveFlowId(flowId);
      setActiveFilePath(null);
      setActiveDbId(null);
      if (flowId !== null) setLeftTab('flows');
    },
    [setActiveFlowId, setActiveFilePath, setActiveDbId, setLeftTab],
  );

  const showDatabaseView = useCallback(
    (dbId: string | null) => {
      setActiveDbId(dbId);
      setActiveFilePath(null);
      setActiveFlowId(null);
      if (dbId !== null) setLeftTab('databases');
    },
    [setActiveDbId, setActiveFilePath, setActiveFlowId, setLeftTab],
  );

  const handleOpenFlow = useCallback(
    (flowId: string, flowName: string, pinned: boolean) => {
      setOpenFlows((prev) => {
        const existing = prev.find((f) => f.id === flowId);
        if (existing) {
          // Update name too — it may be the 'Flow' placeholder from a URL restore.
          return prev.map((f) =>
            f.id === flowId
              ? { ...f, name: flowName, pinned: pinned || f.pinned }
              : f,
          );
        }
        if (pinned) return [...prev, { id: flowId, name: flowName, pinned: true }];
        const hasUnpinned = prev.find((f) => !f.pinned);
        if (hasUnpinned) {
          return prev.map((f) =>
            !f.pinned ? { id: flowId, name: flowName, pinned: false } : f,
          );
        }
        return [...prev, { id: flowId, name: flowName, pinned: false }];
      });
      showFlowView(flowId);
    },
    [showFlowView],
  );

  const handleOpenDatabase = useCallback(
    (dbId: string, dbName: string, pinned: boolean) => {
      setOpenDatabases((prev) => {
        const existing = prev.find((d) => d.id === dbId);
        if (existing) {
          return prev.map((d) =>
            d.id === dbId ? { ...d, pinned: pinned || d.pinned } : d,
          );
        }
        if (pinned) return [...prev, { id: dbId, name: dbName, pinned: true }];
        const hasUnpinned = prev.find((d) => !d.pinned);
        if (hasUnpinned) {
          return prev.map((d) =>
            !d.pinned ? { id: dbId, name: dbName, pinned: false } : d,
          );
        }
        return [...prev, { id: dbId, name: dbName, pinned: false }];
      });
      showDatabaseView(dbId);
    },
    [showDatabaseView],
  );

  const handleLeftTabChange = useCallback(
    (tab: string | null) => {
      const next = tab ?? 'home';
      setLeftTab(next);
      if (next === 'flows' && activeFlowId === null && openFlows.length > 0) {
        setActiveFlowId(openFlows[openFlows.length - 1].id);
      } else if (
        next === 'files' &&
        activeFilePath === null &&
        openFiles.length > 0
      ) {
        setActiveFilePath(openFiles[openFiles.length - 1].path);
      } else if (
        next === 'databases' &&
        activeDbId === null &&
        openDatabases.length > 0
      ) {
        setActiveDbId(openDatabases[openDatabases.length - 1].id);
      }
    },
    [
      setLeftTab,
      activeFlowId,
      openFlows,
      setActiveFlowId,
      activeFilePath,
      openFiles,
      setActiveFilePath,
      activeDbId,
      openDatabases,
      setActiveDbId,
    ],
  );

  // Mirror ?file / ?flow into state on Back/Forward + deep links.
  useEffect(() => {
    setActiveFilePathState(searchParams?.get('file') ?? null);
    setActiveFlowIdState(searchParams?.get('flow') ?? null);
  }, [searchParams]);

  const value = useMemo<OpenTabsContextValue>(
    () => ({
      openFiles,
      activeFilePath,
      setActiveFilePath,
      handleOpenFile,
      handleCloseFile,
      openFlows,
      activeFlowId,
      setActiveFlowId,
      handleOpenFlow,
      handleCloseFlow,
      syncFlowNames,
      openDatabases,
      activeDbId,
      setActiveDbId,
      handleOpenDatabase,
      handleCloseDatabase,
      clearActiveDetailView,
      showFileView,
      handleSelectTab,
      showFlowView,
      showDatabaseView,
      handleLeftTabChange,
    }),
    [
      openFiles,
      activeFilePath,
      setActiveFilePath,
      handleOpenFile,
      handleCloseFile,
      openFlows,
      activeFlowId,
      setActiveFlowId,
      handleOpenFlow,
      handleCloseFlow,
      syncFlowNames,
      openDatabases,
      activeDbId,
      setActiveDbId,
      handleOpenDatabase,
      handleCloseDatabase,
      clearActiveDetailView,
      showFileView,
      handleSelectTab,
      showFlowView,
      showDatabaseView,
      handleLeftTabChange,
    ],
  );

  return (
    <OpenTabsContext.Provider value={value}>
      {children}
    </OpenTabsContext.Provider>
  );
}

export function useOpenTabs(): OpenTabsContextValue {
  const ctx = useContext(OpenTabsContext);
  if (!ctx) {
    throw new Error('useOpenTabs must be used inside <OpenTabsProvider>');
  }
  return ctx;
}
