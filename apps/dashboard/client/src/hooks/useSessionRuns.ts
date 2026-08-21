/**
 * The agent-sessions runs of one repo (the Activity tab's left rail). A read
 * plus its `refetch` — the house `useSpecSources` shape. The list endpoint
 * returns FULL run records (session index included), so the rail and the
 * per-run session list render from one read; live updates to the selected run
 * ride `useRunStream`, not this hook. The server watches the repo's sessions
 * store and pushes `session:runs-changed` on any run.json write (a CLI-started
 * run, a session appearing, a finish) — this hook re-reads on that signal, so
 * the rail never needs a page refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import type { PublicSessionRun } from '@/lib/api';
import { connectSocket } from '@/lib/socket';

export interface SessionRunsState {
  /** null until the first read lands — a spinner, not "no runs". */
  runs: PublicSessionRun[] | null;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useSessionRuns(repoId: string, enabled: boolean, reloadKey = 0): SessionRunsState {
  const [runs, setRuns] = useState<PublicSessionRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    try {
      const res = await api.listSessionRuns(repoId);
      if (!alive.current) return;
      setRuns(res.runs);
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

  // Re-read whenever the server saw a run.json change in this repo's store.
  // The repo room membership comes from the page-level joinRepo.
  useEffect(() => {
    if (!enabled) return;
    const socket = connectSocket();
    const onChanged = (payload: { repoId: string }): void => {
      if (payload.repoId === repoId) void read();
    };
    socket.on('session:runs-changed', onChanged);
    return () => {
      socket.off('session:runs-changed', onChanged);
    };
  }, [repoId, enabled, read]);

  return { runs, error, refetch: read };
}
