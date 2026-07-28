/**
 * The External APIs tab's ONE fetch (item 62) — the joined externals view plus the
 * single-service write.
 *
 * The write answers with the fresh view, so a save swaps state from the response
 * (no follow-up GET); the server ALSO emits `spec:complete { kind:
 * 'guard-externals' }`, which bumps the page-level guard reload key — that arrives
 * as a changed `reloadKey` here and refetches, keeping a second browser tab honest.
 *
 * A refused write (422 — no recipe, no `api` block, a declaration that would not
 * load) is returned as an error STRING rather than thrown: it is the user's problem
 * to fix and the card renders it inline.
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { GuardExternalPatch, GuardExternalsView } from '@/types/guard-externals';

export interface GuardExternalsState {
  view: GuardExternalsView | null;
  loading: boolean;
  /** A failed READ (the page can render nothing). */
  error: string | null;
  /** Save one service (or `null` to remove it). Resolves to an error message, or null on success. */
  save: (service: string, patch: GuardExternalPatch | null) => Promise<string | null>;
  saving: boolean;
  refetch: () => Promise<void>;
}

export function useGuardExternals(
  repoId: string | undefined,
  enabled = true,
  reloadKey = 0,
): GuardExternalsState {
  const [view, setView] = useState<GuardExternalsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    if (!repoId || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      setView(await api.getGuardExternals(repoId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load external API accounts');
      setView(null);
    } finally {
      setLoading(false);
    }
    // reloadKey is a refetch signal (a guard-externals / generate completion): re-run
    // even though the fetch inputs are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, enabled, reloadKey]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const save = useCallback(
    async (service: string, patch: GuardExternalPatch | null): Promise<string | null> => {
      if (!repoId) return 'No repository.';
      setSaving(true);
      try {
        setView(await api.saveGuardExternals(repoId, { [service]: patch }));
        return null;
      } catch (e) {
        if (e instanceof ApiError) return e.message;
        return e instanceof Error ? e.message : 'Failed to save the external API account';
      } finally {
        setSaving(false);
      }
    },
    [repoId],
  );

  return { view, loading, error, save, saving, refetch };
}
