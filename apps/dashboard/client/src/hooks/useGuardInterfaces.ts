/**
 * The Interfaces-tab catalog (`guard/interfaces`) plus its ONE action, Map. Mapping is
 * deterministic and LLM-free, so it has no estimate and no progress stream: the
 * POST answers with the fresh catalog view and the hook swaps state from that
 * response — no refetch, no socket. Hoisted at page level so the catalog list, the
 * detail pane, and the Flows tab's scenario interfaces all read ONE fetch.
 */

import { useCallback, useEffect, useState } from 'react';
import type { GuardInterfacesView } from '@truecourse/shared';
import * as api from '@/lib/api';

export interface GuardInterfacesState {
  view: GuardInterfacesView | null;
  loading: boolean;
  error: string | null;
  /** A Map is in flight (the button's busy state). */
  mapping: boolean;
  /** Re-derive the catalog from the working tree; swaps in the response. */
  map: () => Promise<void>;
}

export function useGuardInterfaces(
  repoId: string | undefined,
  enabled: boolean,
  reloadKey = 0,
  ref?: string,
): GuardInterfacesState {
  const [view, setView] = useState<GuardInterfacesView | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getGuardInterfaces(repoId, ref)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load interfaces');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, reloadKey, ref]);

  const map = useCallback(async () => {
    if (!repoId) return;
    setMapping(true);
    setError(null);
    try {
      setView(await api.mapGuardInterfaces(repoId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Interface mapping failed');
    } finally {
      setMapping(false);
    }
  }, [repoId]);

  return { view, loading, error, mapping, map };
}
