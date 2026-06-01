/**
 * BL-Drift view state: the spec/canonical/contracts/verify panes.
 *
 * Holds which spec conflict is being reviewed, the canonical-spec and
 * contracts file viewers (same transient/pinned tab model as the code
 * viewers), and the verify drift tabs. The right pane is single-slot,
 * so selecting a conflict and opening a canonical section are mutually
 * exclusive (each clears the other).
 *
 * The canonical-spec and contracts file viewers mirror their active path
 * to the URL (?canonical / ?contract), matching how the analysis-section
 * viewers mirror ?file / ?flow — so a reload or deep link restores the open
 * file. Spec conflicts and verify drift tabs stay local (drift ids are
 * regenerated each run, so they aren't URL-stable). The verify run lives
 * outside this context (useVerifyState in RepoPage); `reconcileDriftTabs`
 * lets the page prune open drift tabs whose ids no longer exist after a re-run.
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
  // Spec conflict (right pane)
  activeSpecConflictId: string | null;
  setActiveSpecConflictId: (id: string | null) => void;
  /** Select a conflict; clears any active canonical file (single-slot pane). */
  handleSelectSpecConflict: (id: string | null) => void;

  // Canonical-spec file viewer
  activeCanonicalPath: string | null;
  setActiveCanonicalPath: (path: string | null) => void;
  openCanonicalFiles: ViewerTab[];
  handleOpenCanonical: (path: string, pinned: boolean) => void;
  handleCloseCanonical: (path: string) => void;

  // Contracts file viewer
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
}

const DriftViewContext = createContext<DriftViewContextValue | null>(null);

export function DriftViewProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const canonicalFromUrl = searchParams?.get('canonical') || null;
  const contractFromUrl = searchParams?.get('contract') || null;

  const [activeSpecConflictId, setActiveSpecConflictId] = useState<string | null>(
    null,
  );

  const [activeCanonicalPath, setActiveCanonicalPathState] = useState<string | null>(
    canonicalFromUrl,
  );
  const [openCanonicalFiles, setOpenCanonicalFiles] = useState<ViewerTab[]>(() =>
    canonicalFromUrl ? [{ path: canonicalFromUrl, pinned: true }] : [],
  );
  const setActiveCanonicalPath = useCallback(
    (path: string | null) => {
      setActiveCanonicalPathState(path);
      const url = new URL(window.location.href);
      if (path) url.searchParams.set('canonical', path);
      else url.searchParams.delete('canonical');
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

  const handleOpenCanonical = useCallback((path: string, pinned: boolean) => {
    setOpenCanonicalFiles((prev) => {
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
    setActiveCanonicalPath(path);
    // Right pane is single-slot: opening a canonical section deselects
    // any active conflict so the new selection wins display priority.
    setActiveSpecConflictId(null);
  }, []);

  const handleSelectSpecConflict = useCallback((id: string | null) => {
    setActiveSpecConflictId(id);
    if (id !== null) setActiveCanonicalPath(null);
  }, []);

  const handleCloseCanonical = useCallback(
    (path: string) => {
      setOpenCanonicalFiles((prev) => prev.filter((f) => f.path !== path));
      if (activeCanonicalPath === path) {
        const remaining = openCanonicalFiles.filter((f) => f.path !== path);
        setActiveCanonicalPath(
          remaining.length > 0 ? remaining[remaining.length - 1].path : null,
        );
      }
    },
    [openCanonicalFiles, activeCanonicalPath],
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

  // Mirror ?canonical / ?contract / ?drift into state on Back/Forward + deep links.
  useEffect(() => {
    setActiveCanonicalPathState(searchParams?.get('canonical') ?? null);
    setActiveContractsPathState(searchParams?.get('contract') ?? null);
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
    }),
    [
      activeSpecConflictId,
      handleSelectSpecConflict,
      activeCanonicalPath,
      openCanonicalFiles,
      handleOpenCanonical,
      handleCloseCanonical,
      activeContractsPath,
      openContractsFiles,
      handleOpenContracts,
      handleCloseContracts,
      activeDriftId,
      openDriftTabs,
      handleOpenDrift,
      handleCloseDrift,
      reconcileDriftTabs,
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
