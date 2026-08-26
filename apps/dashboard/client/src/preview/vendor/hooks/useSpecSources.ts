/**
 * The registered web sources of one repo, llms.txt documentation sites
 * snapshotted as spec docs (`truecourse spec source`).
 *
 * A read plus its `refetch`: the Sources page owns the mutations (add / refresh
 * / remove) and re-reads the registry itself the moment one lands, so the list
 * is never a socket round-trip behind the action that changed it. `reloadKey` is
 * the OTHER refetch signal, bumped by the page on `spec:complete { kind:
 * 'sources' }`, the same idiom `useGuardDependencies` takes, so a CLI-side add
 * shows up too. `enabled` keeps a repo without a local checkout (or a workspace
 * corpus) from asking for a registry it cannot have.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/preview/vendor/lib/api';
import type { SpecSourceView } from '@/preview/vendor/lib/api';

export interface SpecSourcesState {
  /** null until the first read lands, a spinner, not "no sources". */
  sources: SpecSourceView[] | null;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useSpecSources(repoId: string, enabled: boolean, reloadKey = 0): SpecSourcesState {
  const [sources, setSources] = useState<SpecSourceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** False once unmounted, a request in flight must not touch state after that. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    try {
      const res = await api.listSpecSources(repoId);
      if (!alive.current) return;
      setSources(res.sources);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [repoId]);

  useEffect(() => {
    if (!enabled) return;
    void read();
  }, [read, enabled, reloadKey]);

  return { sources, error, refetch: read };
}
