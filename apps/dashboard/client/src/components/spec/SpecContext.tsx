/**
 * Shared state for the Spec tab. The list (sidebar) and the detail
 * (main content) live in different parts of the React tree, so we
 * hoist scan/decision/apply state into context so both can read and
 * mutate it.
 *
 * On mount: hydrate from the persisted `scan-state.json` via
 * `GET /spec/scan-state`. Falls back to the "Run scan" CTA when no
 * scan has ever been persisted.
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
import * as api from '@/lib/api';
import type {
  SpecApplyResponse,
  SpecConflict,
  SpecResolution,
  SpecScanResponse,
} from '@/lib/api';

export interface SpecContextValue {
  scan: SpecScanResponse | null;
  hydrating: boolean;
  loading: boolean;
  applying: boolean;
  error: string | null;
  applyResult: SpecApplyResponse | null;
  busyConflictId: string | null;
  /**
   * Bumped every time the canonical spec is rewritten (after Apply).
   * Components that fetch the canonical tree treat this as a cache
   * key in their useEffect deps so they re-fetch automatically.
   */
  canonicalVersion: number;
  /** Run a fresh scan. */
  refresh: () => Promise<void>;
  /** Pick / customise a single conflict and refresh. */
  resolveConflict: (
    conflict: SpecConflict,
    resolution: SpecResolution,
  ) => Promise<void>;
  /** Accept the engine's default pick on every open conflict. */
  acceptAllDefaults: () => Promise<void>;
  /** Write the canonical spec + run IL extraction. */
  apply: () => Promise<void>;
}

const SpecContext = createContext<SpecContextValue | null>(null);

export function SpecProvider({
  repoId,
  children,
}: {
  repoId: string;
  children: ReactNode;
}) {
  const [scan, setScan] = useState<SpecScanResponse | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<SpecApplyResponse | null>(null);
  const [busyConflictId, setBusyConflictId] = useState<string | null>(null);
  const [canonicalVersion, setCanonicalVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const persisted = await api.getSpecScanState(repoId);
        if (!cancelled && persisted) setScan(persisted);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getSpecScan(repoId);
      setScan(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  const resolveConflict = useCallback(
    async (conflict: SpecConflict, resolution: SpecResolution) => {
      setBusyConflictId(conflict.id);
      try {
        await api.postSpecDecision(repoId, {
          conflictId: conflict.id,
          resolution,
          candidateFingerprint: conflict.candidateFingerprint,
        });
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusyConflictId(null);
      }
    },
    [repoId, refresh],
  );

  const acceptAllDefaults = useCallback(async () => {
    setLoading(true);
    try {
      await api.postSpecDecisionsBatch(repoId, 'all-defaults');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [repoId, refresh]);

  const apply = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      const r = await api.postSpecApply(repoId);
      setApplyResult(r);
      // Canonical files were just rewritten — bump the version so
      // SpecCanonicalPanel re-fetches the tree on its next mount /
      // effect run.
      setCanonicalVersion((v) => v + 1);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }, [repoId, refresh]);

  const value = useMemo<SpecContextValue>(
    () => ({
      scan,
      hydrating,
      loading,
      applying,
      error,
      applyResult,
      busyConflictId,
      canonicalVersion,
      refresh,
      resolveConflict,
      acceptAllDefaults,
      apply,
    }),
    [
      scan,
      hydrating,
      loading,
      applying,
      error,
      applyResult,
      busyConflictId,
      canonicalVersion,
      refresh,
      resolveConflict,
      acceptAllDefaults,
      apply,
    ],
  );

  return <SpecContext.Provider value={value}>{children}</SpecContext.Provider>;
}

export function useSpec(): SpecContextValue {
  const ctx = useContext(SpecContext);
  if (!ctx) {
    throw new Error('useSpec must be used inside <SpecProvider>');
  }
  return ctx;
}
