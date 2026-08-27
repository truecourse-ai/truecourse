/**
 * The Dependencies tab's ONE fetch, the joined catalog view plus the
 * single-dependency registration write.
 *
 * The write answers with the fresh view, so a save swaps state from the response
 * (no follow-up GET); the server ALSO emits `spec:complete { kind:
 * 'guard-externals' }`, which bumps the page-level guard reload key, that arrives
 * as a changed `reloadKey` here and refetches, keeping a second browser tab honest.
 *
 * A refused write (422, an undeclared variable, a class with nothing to register,
 * a broken overlay) is returned as an error STRING rather than thrown: it is the
 * user's problem to fix and the detail renders it inline.
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/preview/vendor/lib/api';
import { ApiError } from '@/preview/vendor/lib/api';
import type { GuardDependenciesView, GuardDependencyPatch } from '@/preview/vendor/types/guard-dependencies';

export interface GuardDependenciesState {
  view: GuardDependenciesView | null;
  loading: boolean;
  /** A failed READ (the page can render nothing). */
  error: string | null;
  /** Register one dependency's instance. Resolves to an error message, or null. */
  save: (name: string, patch: GuardDependencyPatch) => Promise<string | null>;
  saving: boolean;
  refetch: () => Promise<void>;
}

export function useGuardDependencies(
  repoId: string | undefined,
  enabled = true,
  reloadKey = 0,
): GuardDependenciesState {
  const [view, setView] = useState<GuardDependenciesView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    if (!repoId || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      setView(await api.getGuardDependencies(repoId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the dependencies');
      setView(null);
    } finally {
      setLoading(false);
    }
    // reloadKey is a refetch signal (a registration / generate completion): re-run
    // even though the fetch inputs are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, enabled, reloadKey]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const save = useCallback(
    async (name: string, patch: GuardDependencyPatch): Promise<string | null> => {
      if (!repoId) return 'No repository.';
      setSaving(true);
      try {
        setView(await api.saveGuardDependency(repoId, name, patch));
        return null;
      } catch (e) {
        if (e instanceof ApiError) return e.message;
        return e instanceof Error ? e.message : 'Failed to register the dependency';
      } finally {
        setSaving(false);
      }
    },
    [repoId],
  );

  return { view, loading, error, save, saving, refetch };
}
