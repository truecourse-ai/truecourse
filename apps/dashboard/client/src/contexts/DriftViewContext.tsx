/**
 * BL-Drift view state: the spec/contracts/verify panes.
 *
 * Holds the corpus Spec tab viewer, the contracts file viewer (same
 * transient/pinned tab model as the code viewers), and the verify drift tabs.
 *
 * The corpus Spec tab and contracts file viewers mirror their active path to
 * the URL (?spec / ?contract), matching how the analysis-section viewers mirror
 * ?file / ?flow — so a reload or deep link restores the open item. Verify drift
 * tabs stay local (drift ids are regenerated each run, so they aren't
 * URL-stable). The verify run lives outside this context (useVerifyState in
 * RepoPage); `reconcileDriftTabs` lets the page prune open drift tabs whose ids
 * no longer exist after a re-run.
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

export type ViewerTab = { path: string; pinned: boolean };
export type DriftTab = { id: string; pinned: boolean };

export interface DriftViewContextValue {
  // Corpus Spec tab viewer — a source doc (markdown) or an overlap (resolution),
  // keyed by a doc ref / `overlap::…` key. URL-synced as `?spec=`.
  activeSpecPath: string | null;
  setActiveSpecPath: (path: string | null) => void;
  openSpecTabs: ViewerTab[];
  handleOpenSpec: (path: string, pinned: boolean) => void;
  handleCloseSpec: (path: string) => void;

  // Contracts right pane: holds both `.tc` file paths and generate-result keys
  // (`issue::<i>` / `gap::<i>`) in one transient/pinned tab set — the viewer
  // switches on the key. URL-synced as `?contract=`.
  activeContractsPath: string | null;
  setActiveContractsPath: (path: string | null) => void;
  openContractsFiles: ViewerTab[];
  handleOpenContracts: (path: string, pinned: boolean) => void;
  handleCloseContracts: (path: string) => void;

  // Verify drift tabs
  activeDriftId: string | null;
  setActiveDriftId: (id: string | null) => void;
  openDriftTabs: DriftTab[];
  handleOpenDrift: (id: string, pinned: boolean) => void;
  handleCloseDrift: (id: string) => void;
  /**
   * Prune open drift tabs to the still-valid ids after a verify re-run.
   * Pass null to clear everything (no verify state).
   */
  reconcileDriftTabs: (validIds: Set<string> | null) => void;

  /**
   * EE ref switcher: which commit the repo's spec/contracts/drift views read.
   * '' = the default branch (LATEST). A PR head SHA → that PR's stored snapshot.
   * URL-synced as `?ref=` so reloads + shared links keep the lens.
   */
  selectedRef: string;
  setSelectedRef: (ref: string) => void;
}

const DriftViewContext = createContext<DriftViewContextValue | null>(null);

export function DriftViewProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const contractFromUrl = searchParams?.get('contract') || null;
  const specFromUrl = searchParams?.get('spec') || null;

  // EE ref switcher (default branch vs a PR head), URL-synced as `?ref=`.
  const [selectedRef, setSelectedRefState] = useState<string>(
    searchParams?.get('ref') || '',
  );
  const setSelectedRef = useCallback(
    (ref: string) => {
      setSelectedRefState(ref);
      const url = new URL(window.location.href);
      if (ref) url.searchParams.set('ref', ref);
      else url.searchParams.delete('ref');
      navigate(url.pathname + url.search);
    },
    [navigate],
  );

  const [activeContractsPath, setActiveContractsPathState] = useState<string | null>(
    contractFromUrl,
  );
  const [openContractsFiles, setOpenContractsFiles] = useState<ViewerTab[]>(() =>
    contractFromUrl ? [{ path: contractFromUrl, pinned: true }] : [],
  );
  const setActiveContractsPath = useCallback(
    (path: string | null) => {
      setActiveContractsPathState(path);
      const url = new URL(window.location.href);
      if (path) url.searchParams.set('contract', path);
      else url.searchParams.delete('contract');
      navigate(url.pathname + url.search);
    },
    [navigate],
  );

  const handleOpenContracts = useCallback((path: string, pinned: boolean) => {
    setOpenContractsFiles((prev) => {
      const existing = prev.find((f) => f.path === path);
      if (existing) {
        return prev.map((f) =>
          f.path === path ? { ...f, pinned: pinned || f.pinned } : f,
        );
      }
      if (pinned) return [...prev, { path, pinned: true }];
      const hasUnpinned = prev.find((f) => !f.pinned);
      if (hasUnpinned) return prev.map((f) => (!f.pinned ? { path, pinned: false } : f));
      return [...prev, { path, pinned: false }];
    });
    setActiveContractsPath(path);
  }, []);

  const handleCloseContracts = useCallback(
    (path: string) => {
      setOpenContractsFiles((prev) => prev.filter((f) => f.path !== path));
      if (activeContractsPath === path) {
        const remaining = openContractsFiles.filter((f) => f.path !== path);
        setActiveContractsPath(
          remaining.length > 0 ? remaining[remaining.length - 1].path : null,
        );
      }
    },
    [openContractsFiles, activeContractsPath],
  );

  // --- Corpus Spec tab viewer (`?spec=`) — same transient/pinned tab model ----
  const [activeSpecPath, setActiveSpecPathState] = useState<string | null>(specFromUrl);
  const [openSpecTabs, setOpenSpecTabs] = useState<ViewerTab[]>(() =>
    specFromUrl ? [{ path: specFromUrl, pinned: true }] : [],
  );
  const setActiveSpecPath = useCallback(
    (path: string | null) => {
      setActiveSpecPathState(path);
      const url = new URL(window.location.href);
      if (path) url.searchParams.set('spec', path);
      else url.searchParams.delete('spec');
      navigate(url.pathname + url.search);
    },
    [navigate],
  );
  const handleOpenSpec = useCallback(
    (path: string, pinned: boolean) => {
      setOpenSpecTabs((prev) => {
        const existing = prev.find((f) => f.path === path);
        if (existing) return prev.map((f) => (f.path === path ? { ...f, pinned: pinned || f.pinned } : f));
        if (pinned) return [...prev, { path, pinned: true }];
        const hasUnpinned = prev.find((f) => !f.pinned);
        if (hasUnpinned) return prev.map((f) => (!f.pinned ? { path, pinned: false } : f));
        return [...prev, { path, pinned: false }];
      });
      setActiveSpecPath(path);
    },
    [setActiveSpecPath],
  );
  const handleCloseSpec = useCallback(
    (path: string) => {
      setOpenSpecTabs((prev) => prev.filter((f) => f.path !== path));
      if (activeSpecPath === path) {
        const remaining = openSpecTabs.filter((f) => f.path !== path);
        setActiveSpecPath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
      }
    },
    [openSpecTabs, activeSpecPath, setActiveSpecPath],
  );

  // --- Verify drift tabs -------------------------------------------
  // The selected drift mirrors to ?drift. Drift ids are stable within a run
  // (persisted in LATEST) so they survive reloads; a new verify run
  // regenerates them, and `reconcileDriftTabs` clears a now-invalid selection
  // (which the state→URL effect below then drops from the URL). Because
  // `reconcileDriftTabs`/`handleCloseDrift` need functional state updates, the
  // selection syncs to the URL via an effect rather than a wrapped setter.
  const driftFromUrl = searchParams?.get('drift') || null;
  const [activeDriftId, setActiveDriftId] = useState<string | null>(driftFromUrl);
  const [openDriftTabs, setOpenDriftTabs] = useState<DriftTab[]>(() =>
    driftFromUrl ? [{ id: driftFromUrl, pinned: true }] : [],
  );

  const handleOpenDrift = useCallback((id: string, pinned: boolean) => {
    setOpenDriftTabs((prev) => {
      const existing = prev.find((d) => d.id === id);
      if (existing) {
        return prev.map((d) =>
          d.id === id ? { ...d, pinned: pinned || d.pinned } : d,
        );
      }
      if (pinned) return [...prev, { id, pinned: true }];
      const hasUnpinned = prev.find((d) => !d.pinned);
      if (hasUnpinned) return prev.map((d) => (!d.pinned ? { id, pinned: false } : d));
      return [...prev, { id, pinned: false }];
    });
    setActiveDriftId(id);
  }, []);

  const handleCloseDrift = useCallback(
    (id: string) => {
      setOpenDriftTabs((prev) => prev.filter((d) => d.id !== id));
      if (activeDriftId === id) {
        const remaining = openDriftTabs.filter((d) => d.id !== id);
        setActiveDriftId(
          remaining.length > 0 ? remaining[remaining.length - 1].id : null,
        );
      }
    },
    [openDriftTabs, activeDriftId],
  );

  const reconcileDriftTabs = useCallback((validIds: Set<string> | null) => {
    if (validIds === null) {
      setOpenDriftTabs([]);
      setActiveDriftId(null);
      return;
    }
    setOpenDriftTabs((prev) => prev.filter((d) => validIds.has(d.id)));
    setActiveDriftId((prev) => (prev && validIds.has(prev) ? prev : null));
  }, []);

  // Mirror ?spec / ?contract / ?drift into state on Back/Forward + deep links.
  useEffect(() => {
    setActiveContractsPathState(searchParams?.get('contract') ?? null);
    setActiveSpecPathState(searchParams?.get('spec') ?? null);
    setActiveDriftId(searchParams?.get('drift') ?? null);
  }, [searchParams]);

  // Mirror the selected drift to ?drift. Guarded against re-writing an
  // already-matching URL so it doesn't loop with the effect above or stack
  // history entries on Back/Forward.
  useEffect(() => {
    const current = new URLSearchParams(window.location.search).get('drift');
    if ((activeDriftId ?? '') === (current ?? '')) return;
    const url = new URL(window.location.href);
    if (activeDriftId) url.searchParams.set('drift', activeDriftId);
    else url.searchParams.delete('drift');
    navigate(url.pathname + url.search);
  }, [activeDriftId, navigate]);

  const value = useMemo<DriftViewContextValue>(
    () => ({
      activeSpecPath,
      setActiveSpecPath,
      openSpecTabs,
      handleOpenSpec,
      handleCloseSpec,
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
      selectedRef,
      setSelectedRef,
    }),
    [
      activeSpecPath,
      setActiveSpecPath,
      openSpecTabs,
      handleOpenSpec,
      handleCloseSpec,
      activeContractsPath,
      openContractsFiles,
      handleOpenContracts,
      handleCloseContracts,
      activeDriftId,
      openDriftTabs,
      handleOpenDrift,
      handleCloseDrift,
      reconcileDriftTabs,
      selectedRef,
      setSelectedRef,
    ],
  );

  return (
    <DriftViewContext.Provider value={value}>
      {children}
    </DriftViewContext.Provider>
  );
}

export function useDriftView(): DriftViewContextValue {
  const ctx = useContext(DriftViewContext);
  if (!ctx) {
    throw new Error('useDriftView must be used inside <DriftViewProvider>');
  }
  return ctx;
}
