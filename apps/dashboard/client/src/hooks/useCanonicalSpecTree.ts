/**
 * Top-level hook for the canonical spec file tree. Mirrors
 * `useContractsTree`: data lives in RepoPage so it persists
 * across tab switches; parent wires socket events / Apply completion
 * to `refetch()`.
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import type { CanonicalSpecTree } from '@/lib/api';

export function useCanonicalSpecTree(repoId: string | undefined) {
  const [tree, setTree] = useState<CanonicalSpecTree | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const t = await api.getSpecCanonicalTree(repoId);
      setTree(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load canonical spec');
    } finally {
      setIsLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { tree, isLoading, error, refetch };
}
