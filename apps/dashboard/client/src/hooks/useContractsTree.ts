/**
 * Top-level hook for the BL Drift Contracts tree. Same shape as
 * `useGraph` / `useFlows`: `{ tree, isLoading, error, refetch }`.
 *
 * Mounted in RepoPage so the tree survives tab switches —
 * navigating contracts → graphs → contracts keeps the data warm
 * instead of re-fetching. The parent wires `spec:complete` events
 * from the socket to `refetch()` so a successful Apply auto-refreshes
 * the tree.
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import type { ContractsTree } from '@/lib/api';

export function useContractsTree(repoId: string | undefined, ref?: string) {
  const [tree, setTree] = useState<ContractsTree | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const t = await api.getContractsTree(repoId, ref);
      setTree(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contracts');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, ref]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { tree, isLoading, error, refetch };
}
