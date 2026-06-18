/**
 * Shared state for the Spec tab. The list (sidebar) and the detail
 * (main content) live in different parts of the React tree, so we
 * hoist scan + decision state into context so both can read and
 * mutate it.
 *
 * The provider is parameterized by a `SpecDataSource` — the seam that
 * decides WHERE the spec data lives. A repo source (`createRepoSpecDataSource`)
 * talks to `/api/repos/:id/spec/*`; the enterprise Knowledge page passes a
 * workspace source talking to `/api/ee/knowledge/*`. The panels
 * (`SpecPanel`/`DecisionsPanel`/`SpecConflictDetail`/`SpecCanonicalFile`) are
 * identical regardless of source — they only read `useSpec()`.
 *
 * On mount: hydrate from the persisted scan-state. Falls back to the
 * "Run scan" empty state when no scan has ever been persisted.
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
  CanonicalSpecSection,
  CanonicalSpecTree,
  SpecConflict,
  SpecResolution,
  SpecScanResponse,
} from '@/lib/api';

/**
 * A human-facing label for a source doc, resolved from its internal `docPath`.
 * Workspace (connector) docs have a `docPath` like `knowledge/confluence/98423.md`
 * — a stable id, not a filename — so the UI shows this title (linked to the
 * source) instead. Repo docs have no labels; their `provenance.file` IS a real
 * path, shown as-is.
 */
export interface DocLabel {
  title: string;
  url?: string;
}

/**
 * The storage-agnostic data seam behind the Spec views. Repo and workspace
 * differ ONLY here — same components, different backend (files vs Postgres).
 */
export interface SpecDataSource {
  /**
   * Whether an on-demand "Rescan" is possible. Repos re-read the working tree
   * (cheap, via the block cache); workspace Knowledge has no docs on the server
   * (re-process by re-uploading), so its Rescan button is hidden.
   */
  readonly supportsRescan: boolean;
  /** Read the persisted scan-state (mount). */
  hydrate(): Promise<SpecScanResponse | null>;
  /** Refresh after a change: repo re-scans; workspace re-reads (the server already re-merged). */
  refresh(): Promise<SpecScanResponse | null>;
  postDecision(input: {
    conflictId: string;
    resolution: SpecResolution;
    candidateFingerprint: string;
  }): Promise<void>;
  acceptAllDefaults(): Promise<void>;
  revokeDecision(conflictId: string): Promise<void>;
  markSuperseded(older: string, newer: string, note?: string): Promise<void>;
  includeDoc(docPath: string): Promise<void>;
  loadCanonicalTree(): Promise<CanonicalSpecTree>;
  loadCanonicalSection(moduleName: string, topic: string): Promise<CanonicalSpecSection>;
  /**
   * Optional `docPath → {title, url}` map so source docs render by their human
   * title (workspace/connector docs). Absent for repo sources (paths are real).
   */
  loadDocLabels?(): Promise<Record<string, DocLabel>>;
}

/**
 * Repo-scoped source: the `/api/repos/:id/spec/*` behavior.
 *
 * `hosted` (enterprise) repos have no working tree on the server — the docs were
 * cloned transiently during the gate scan and discarded. So there's no on-demand
 * Scan (the server can't re-read docs), and a decision refresh re-reads the
 * server-re-merged scan-state (`getSpecScanState`) instead of re-consolidating
 * (`getSpecScan`, which would 400 "not a git repository").
 */
export function createRepoSpecDataSource(repoId: string, ref?: string, hosted = false): SpecDataSource {
  return {
    supportsRescan: !hosted,
    hydrate: () => api.getSpecScanState(repoId),
    refresh: () => (hosted ? api.getSpecScanState(repoId) : api.getSpecScan(repoId)),
    postDecision: (input) => api.postSpecDecision(repoId, input).then(() => undefined),
    acceptAllDefaults: () => api.postSpecDecisionsBatch(repoId, 'all-defaults').then(() => undefined),
    revokeDecision: (conflictId) => api.deleteSpecDecision(repoId, conflictId).then(() => undefined),
    markSuperseded: (older, newer, note) =>
      api.postSpecManualChain(repoId, { older, newer, note }).then(() => undefined),
    includeDoc: (docPath) => api.postSpecManualInclude(repoId, { path: docPath }).then(() => undefined),
    loadCanonicalTree: () => api.getSpecCanonicalTree(repoId, ref),
    loadCanonicalSection: (moduleName, topic) =>
      api.getSpecCanonicalSection(repoId, moduleName, topic, ref),
  };
}

export interface SpecContextValue {
  scan: SpecScanResponse | null;
  hydrating: boolean;
  loading: boolean;
  error: string | null;
  busyConflictId: string | null;
  /** Whether the Rescan affordance applies (repo) or is hidden (workspace). */
  supportsRescan: boolean;
  /**
   * Bumped every time the scan completes. Components that fetch the
   * canonical tree treat this as a cache key in their useEffect deps
   * so they re-fetch automatically.
   */
  canonicalVersion: number;
  /** Run a fresh scan (repo) / re-read (workspace). */
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
  /** Fetch a canonical `(module, topic)` section from the active source. */
  loadCanonicalSection: (moduleName: string, topic: string) => Promise<CanonicalSpecSection>;
  /**
   * Resolve a source `docPath` to its human title + link, or `undefined` when
   * there's no mapping (repo docs — show the path as-is).
   */
  docLabel: (docPath: string) => DocLabel | undefined;
}

const SpecContext = createContext<SpecContextValue | null>(null);

export function SpecProvider({
  source,
  children,
}: {
  source: SpecDataSource;
  children: ReactNode;
}) {
  const [scan, setScan] = useState<SpecScanResponse | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyConflictId, setBusyConflictId] = useState<string | null>(null);
  const [canonicalVersion, setCanonicalVersion] = useState(0);
  const [docLabels, setDocLabels] = useState<Record<string, DocLabel>>({});

  // Source-doc title/link map (workspace only). Re-fetched when the claim set
  // changes (a sync may have added/removed docs).
  useEffect(() => {
    if (!source.loadDocLabels) {
      setDocLabels({});
      return;
    }
    let cancelled = false;
    source
      .loadDocLabels()
      .then((m) => !cancelled && setDocLabels(m))
      .catch(() => !cancelled && setDocLabels({}));
    return () => {
      cancelled = true;
    };
  }, [source, canonicalVersion]);

  const docLabel = useCallback((path: string) => docLabels[path], [docLabels]);

  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    (async () => {
      try {
        const persisted = await source.hydrate();
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
  }, [source]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await source.refresh();
      if (r) setScan(r);
      // The claim set may have changed — bump the version so any consumer
      // of the canonical tree/section re-fetches.
      setCanonicalVersion((v) => v + 1);
    } catch (e) {
      reportError('Spec scan failed', e, setError);
    } finally {
      setLoading(false);
    }
  }, [source]);

  const resolveConflict = useCallback(
    async (conflict: SpecConflict, resolution: SpecResolution) => {
      setBusyConflictId(conflict.id);
      try {
        await source.postDecision({
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
    [source, refresh],
  );

  const acceptAllDefaults = useCallback(async () => {
    setLoading(true);
    try {
      await source.acceptAllDefaults();
      await refresh();
    } catch (e) {
      reportError('Accept all defaults failed', e, setError);
    } finally {
      setLoading(false);
    }
  }, [source, refresh]);

  const revokeDecision = useCallback(
    async (conflictId: string) => {
      setBusyConflictId(conflictId);
      try {
        await source.revokeDecision(conflictId);
        await refresh();
      } catch (e) {
        reportError('Revoking decision failed', e, setError);
      } finally {
        setBusyConflictId(null);
      }
    },
    [source, refresh],
  );

  const markSuperseded = useCallback(
    async (older: string, newer: string, note?: string) => {
      setLoading(true);
      try {
        await source.markSuperseded(older, newer, note);
        await refresh();
      } catch (e) {
        reportError('Marking supersession failed', e, setError);
      } finally {
        setLoading(false);
      }
    },
    [source, refresh],
  );

  const includeDoc = useCallback(
    async (docPath: string) => {
      setLoading(true);
      try {
        await source.includeDoc(docPath);
        await refresh();
      } catch (e) {
        reportError('Including doc failed', e, setError);
      } finally {
        setLoading(false);
      }
    },
    [source, refresh],
  );

  const loadCanonicalSection = useCallback(
    (moduleName: string, topic: string) => source.loadCanonicalSection(moduleName, topic),
    [source],
  );

  const value = useMemo<SpecContextValue>(
    () => ({
      scan,
      hydrating,
      loading,
      error,
      busyConflictId,
      supportsRescan: source.supportsRescan,
      canonicalVersion,
      refresh,
      resolveConflict,
      acceptAllDefaults,
      revokeDecision,
      markSuperseded,
      includeDoc,
      loadCanonicalSection,
      docLabel,
    }),
    [
      scan,
      hydrating,
      loading,
      error,
      busyConflictId,
      source,
      canonicalVersion,
      refresh,
      resolveConflict,
      acceptAllDefaults,
      revokeDecision,
      markSuperseded,
      includeDoc,
      loadCanonicalSection,
      docLabel,
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
