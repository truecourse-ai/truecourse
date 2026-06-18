/**
 * Top-level hook for the canonical spec file tree. Mirrors
 * `useContractsTree`: data lives in the page so it persists
 * across tab switches; parent wires socket events / Apply completion
 * to `refetch()`.
 *
 * Keyed by a `SpecDataSource` (not a bare repoId) so the same hook serves
 * the repo Spec view and the enterprise workspace Knowledge view — the source
 * decides whether the tree comes from `/api/repos/:id/*` or `/api/ee/knowledge/*`.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CanonicalSpecTree } from '@/lib/api';
import type { SpecDataSource } from '@/components/spec/SpecContext';

export function useCanonicalSpecTree(source: SpecDataSource | undefined) {
  const [tree, setTree] = useState<CanonicalSpecTree | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!source) return;
    setIsLoading(true);
    setError(null);
    try {
      const t = await source.loadCanonicalTree();
      setTree(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load canonical spec');
    } finally {
      setIsLoading(false);
    }
  }, [source]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { tree, isLoading, error, refetch };
}
