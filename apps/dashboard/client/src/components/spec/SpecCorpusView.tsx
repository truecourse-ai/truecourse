/**
 * The curated corpus as a repository reads it: `useSpecCorpus` fetches the
 * repository's slice of the workspace corpus and applies decisions to it, and
 * `parseSpecKey` tells a doc key from a conflict key. The corpus list a reader
 * sees is Context's Documents page; this module holds the state behind it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCorpusConflicts, isConflictId } from '@truecourse/shared';
import type { SpecCorpusResponse, SpecConflictResolution, SpecDecisionAck } from '@/lib/api';
import { createRepoSpecSource, useSpecSource } from '@/components/spec/spec-source';

// Docs are listed once (keyed by their plain ref). A conflict is keyed by the id
// `buildCorpusConflicts` stamps on it, NEVER rebuilt here, because the pair alone
// cannot tell two disputes on the same two docs apart (see `conflictId`).

export type SpecKey =
  | { kind: 'doc'; ref: string }
  | { kind: 'overlap'; area: string; a: string; b: string };

/** Parse a corpus key (a doc ref or a conflict id) into the item it addresses. A conflict id's
 *  trailing discriminator is not needed to LABEL it, so the first four segments
 *  are read and any discriminator ignored, {@link resolveConflictId} is what
 *  turns the id back into the record. */
export function parseSpecKey(key: string): SpecKey {
  if (isConflictId(key)) {
    const [, area, a, b] = key.split('::');
    return { kind: 'overlap', area: area ?? '', a: a ?? '', b: b ?? '' };
  }
  // Back-compat: an older area-scoped `doc::<area>::<ref>` URL still resolves.
  if (key.startsWith('doc::')) {
    const rest = key.slice('doc::'.length);
    const sep = rest.indexOf('::');
    return { kind: 'doc', ref: sep >= 0 ? rest.slice(sep + 2) : rest };
  }
  return { kind: 'doc', ref: key };
}

type DecisionAction = 'exclude' | 'unexclude' | 'include' | 'uninclude';

/**
 * Optimistically toggle a force-include/exclude in the decision lists. The corpus
 * itself stays untouched: the Documents / Not included / Force-* rows are DERIVED
 * from these lists over the corpus at render, so a toggle moves the row in BOTH
 * directions (skip and restore alike) with nothing to revert. Conflicts are
 * deliberately left untouched, they're the authoritative product of the
 * recompute, so they appear/disappear only when a fresh corpus lands.
 */
function optimisticDecision(data: SpecCorpusResponse, ref: string, action: DecisionAction): SpecCorpusResponse {
  const without = (arr?: string[]): string[] => (arr ?? []).filter((r) => r !== ref);
  const withRef = (arr?: string[]): string[] => [...new Set([...(arr ?? []), ref])];
  let manualIncludes = data.manualIncludes;
  let manualExcludes = data.manualExcludes;
  switch (action) {
    case 'exclude':
      manualExcludes = withRef(manualExcludes);
      manualIncludes = without(manualIncludes);
      break;
    case 'unexclude':
      manualExcludes = without(manualExcludes);
      break;
    case 'include':
      manualIncludes = withRef(manualIncludes);
      manualExcludes = without(manualExcludes);
      break;
    case 'uninclude':
      manualIncludes = without(manualIncludes);
      break;
  }
  return { ...data, manualIncludes, manualExcludes };
}

export interface SpecCorpusState {
  data: SpecCorpusResponse | null;
  hydrating: boolean;
  scanning: boolean;
  error: string | null;
  /** Run a fresh corpus scan (curate), wired to the page header's Scan/Rescan. */
  scan: () => Promise<void>;
  /** Re-read the corpus after an inline resolution. */
  refetch: () => Promise<void>;
  /** Replace corpus data from a mutation response (a scan). */
  apply: (res: SpecCorpusResponse) => void;
  /** Reconcile the decision lists onto the current corpus (the include/exclude ack, no re-curate). */
  applyDecisions: (dec: SpecDecisionAck) => void;
  /** Reconcile the section-verdict list onto the current corpus (the conflict ack, no re-curate). */
  applyConflictResolutions: (list: SpecConflictResolution[]) => void;
}

/**
 * Owns the corpus fetch + scan for one repo. `enabled` gates the initial read so
 * the page doesn't fetch a corpus until the surface that reads it is shown.
 */
export function useSpecCorpus(repoId: string, enabled: boolean): SpecCorpusState {
  const [data, setData] = useState<SpecCorpusResponse | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A provided (workspace) source wins; otherwise the repo default.
  const ctxSource = useSpecSource();
  const repoSource = useMemo(() => createRepoSpecSource(repoId), [repoId]);
  const source = ctxSource ?? repoSource;

  useEffect(() => {
    if (!enabled) {
      setHydrating(false);
      return;
    }
    let cancelled = false;
    setHydrating(true);
    source
      .getCorpus()
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setHydrating(false));
    return () => {
      cancelled = true;
    };
  }, [source, enabled]);

  // Starting a scan only ENQUEUES it, so `scanning` stays true past the request:
  // the corpus arrives through `refetch`, which the page calls when the scan's
  // completion event lands. A refused start clears it here.
  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      await source.scan();
    } catch (e) {
      setError((e as Error).message);
      setScanning(false);
    }
  }, [source]);

  const refetch = useCallback(async () => {
    try {
      setData(await source.getCorpus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }, [source]);

  const apply = useCallback((res: SpecCorpusResponse) => setData(res), []);

  // Include/exclude: the corpus is unchanged (no re-curate), so keep the
  // optimistically-moved corpus and only reconcile the persisted decision lists.
  // Functional update so it merges onto the latest (post-optimistic) data.
  const applyDecisions = useCallback(
    (dec: SpecDecisionAck) =>
      setData((prev) =>
        prev ? { ...prev, manualIncludes: dec.manualIncludes, manualExcludes: dec.manualExcludes } : prev,
      ),
    [],
  );

  // A conflict verdict: the corpus is unchanged (no re-curate), so keep it and
  // only reconcile the persisted verdict list, the conflict/orphan rows derive.
  const applyConflictResolutions = useCallback(
    (list: SpecConflictResolution[]) =>
      setData((prev) => (prev ? { ...prev, conflictResolutions: list } : prev)),
    [],
  );

  return {
    data,
    hydrating,
    scanning,
    error,
    scan,
    refetch,
    apply,
    applyDecisions,
    applyConflictResolutions,
  };
}
