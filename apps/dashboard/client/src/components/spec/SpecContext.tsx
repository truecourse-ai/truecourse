/**
 * Shared state for the Spec tab. The list (sidebar) and the detail
 * (main content) live in different parts of the React tree, so we
 * hoist scan + decision state into context so both can read and
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
import { toast } from 'sonner';
import * as api from '@/lib/api';
import type {
  SpecConflict,
  SpecResolution,
  SpecScanResponse,
} from '@/lib/api';

export interface SpecContextValue {
  scan: SpecScanResponse | null;
  hydrating: boolean;
  loading: boolean;
  error: string | null;
  busyConflictId: string | null;
  /**
   * Bumped every time the scan completes. Components that fetch the
   * canonical tree treat this as a cache key in their useEffect deps
   * so they re-fetch automatically.
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
  /** Revoke a previously saved decision and re-scan so the conflict
   *  re-opens with its candidates intact. */
  revokeDecision: (conflictId: string) => Promise<void>;
  /** Mark `older` as superseded by `newer` (manual version chain). */
  markSuperseded: (older: string, newer: string, note?: string) => Promise<void>;
  /** Force-include a doc the LLM relevance filter marked as skipped. */
  includeDoc: (docPath: string) => Promise<void>;
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
  const [error, setError] = useState<string | null>(null);
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
      // Scan rewrites claims.json — bump the version so any consumer
      // of the canonical tree re-fetches.
      setCanonicalVersion((v) => v + 1);
    } catch (e) {
      reportError('Spec scan failed', e, setError);
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
        reportError('Saving decision failed', e, setError);
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
      reportError('Accept all defaults failed', e, setError);
    } finally {
      setLoading(false);
    }
  }, [repoId, refresh]);

  const revokeDecision = useCallback(
    async (conflictId: string) => {
      setBusyConflictId(conflictId);
      try {
        await api.deleteSpecDecision(repoId, conflictId);
        await refresh();
      } catch (e) {
        reportError('Revoking decision failed', e, setError);
      } finally {
        setBusyConflictId(null);
      }
    },
    [repoId, refresh],
  );

  const markSuperseded = useCallback(
    async (older: string, newer: string, note?: string) => {
      setLoading(true);
      try {
        await api.postSpecManualChain(repoId, { older, newer, note });
        await refresh();
      } catch (e) {
        reportError('Marking supersession failed', e, setError);
      } finally {
        setLoading(false);
      }
    },
    [repoId, refresh],
  );

  const includeDoc = useCallback(
    async (docPath: string) => {
      setLoading(true);
      try {
        await api.postSpecManualInclude(repoId, { path: docPath });
        await refresh();
      } catch (e) {
        reportError('Including doc failed', e, setError);
      } finally {
        setLoading(false);
      }
    },
    [repoId, refresh],
  );

  const value = useMemo<SpecContextValue>(
    () => ({
      scan,
      hydrating,
      loading,
      error,
      busyConflictId,
      canonicalVersion,
      refresh,
      resolveConflict,
      acceptAllDefaults,
      revokeDecision,
      markSuperseded,
      includeDoc,
    }),
    [
      scan,
      hydrating,
      loading,
      error,
      busyConflictId,
      canonicalVersion,
      refresh,
      resolveConflict,
      acceptAllDefaults,
      revokeDecision,
      markSuperseded,
      includeDoc,
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

/**
 * Surface a Spec-pipeline error to the user. Both fire a toast (so the
 * user sees it from any tab) and write to `error` state (so SpecPanel's
 * inline alert still works when the user is on the Spec tab).
 */
function reportError(
  title: string,
  err: unknown,
  setError: (msg: string | null) => void,
): void {
  const message = err instanceof Error ? err.message : String(err);
  setError(message);
  toast.error(title, { description: message });
}
