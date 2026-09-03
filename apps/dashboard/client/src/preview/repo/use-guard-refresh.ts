/**
 * A refetch signal for the setup tabs of a REAL repository: a counter that
 * bumps when a guard job of the named kind lands on this repository (a setup
 * re-derived the catalogs, a registration changed what is provided). Setup and
 * registration are jobs and writes elsewhere, and their completion on the socket
 * is the only signal a table gets. Listens on the socket the shell already
 * holds; the shell joins every real repository's room and owns that membership,
 * so this never joins or leaves one. A fixture repository never bumps.
 */

import { useEffect, useState } from 'react';
import { connectSocket } from '@/lib/socket';
import type { Repo } from '@/preview/data/types';

export function useGuardRefresh(repo: Repo, kinds: readonly string[]): number {
  const [key, setKey] = useState(0);
  const kindsKey = kinds.join(',');
  useEffect(() => {
    if (!repo.real) return;
    const wanted = new Set(kindsKey.split(','));
    let socket: ReturnType<typeof connectSocket> | null = null;
    const onComplete = (payload: { repoId?: string; kind?: string }): void => {
      if (payload.repoId === repo.id && payload.kind && wanted.has(payload.kind)) setKey((k) => k + 1);
    };
    try {
      socket = connectSocket();
      socket.on('spec:complete', onComplete);
    } catch {
      socket = null; // no socket transport here — the page still reads once
    }
    return () => {
      socket?.off('spec:complete', onComplete);
    };
  }, [repo.id, repo.real, kindsKey]);
  return key;
}
