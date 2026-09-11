// PREVIEW: REAL. The workspace's agent runs, read across every connected
// repository and kept current without polling.

/**
 * The Agent page's read: `GET /api/sessions/runs`, newest first, plus the two
 * live signals that make it move.
 *
 * A job's own stream (`/api/events`) says a hosted job ticked or settled, which
 * is when a run record is written from the server side; the repository socket's
 * `session:runs-changed` says a run store write landed for one repository, which
 * is what a locally started run produces. Either one re-reads the list, debounced
 * so a burst of progress frames costs one request.
 *
 * Room membership belongs to the shell (`useRealRunStream` joins every real
 * repository once and holds it), so this only listens: a page that joined and
 * left would take the shell's watch down with it.
 *
 * Degrades to nothing: with no server behind the page the read fails quietly and
 * the list stays empty, and a runtime with no EventSource simply has one signal
 * fewer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listWorkspaceRuns, type WorkspaceRun } from '@/lib/api';
import { getServerUrl } from '@/lib/server-url';
import { connectSocket } from '@/lib/socket';

/** How long a signal waits for its neighbours before the list is re-read. */
const DEBOUNCE_MS = 500;

/** The page reads one window of history; older runs are a cursor away. */
const PAGE_LIMIT = 200;

export interface WorkspaceRunsState {
  /** null until the first read lands: loading, not "nothing ran". */
  runs: WorkspaceRun[] | null;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useWorkspaceRuns(repoIds: readonly string[]): WorkspaceRunsState {
  const [runs, setRuns] = useState<WorkspaceRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The repositories as a string, so the effects below are stable while the
  // shell's repo array is rebuilt on every render.
  const repoKey = [...repoIds].sort().join('|');
  const watched = useMemo(() => (repoKey === '' ? [] : repoKey.split('|')), [repoKey]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    try {
      const res = await listWorkspaceRuns({ limit: PAGE_LIMIT });
      if (!alive.current) return;
      setRuns(res.runs);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setRuns((prev) => prev ?? []);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  // One debounced re-read behind both signals.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudge = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void read();
    }, DEBOUNCE_MS);
  }, [read]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const socket = connectSocket();
    const onChanged = (payload: { repoId: string }): void => {
      if (watched.length === 0 || watched.includes(payload.repoId)) nudge();
    };
    socket.on('session:runs-changed', onChanged);
    return () => {
      socket.off('session:runs-changed', onChanged);
    };
  }, [watched, nudge]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    try {
      source = new EventSource(`${getServerUrl()}/api/events`, { withCredentials: true });
    } catch {
      return;
    }
    const onMessage = (e: MessageEvent<string>): void => {
      try {
        const event = JSON.parse(e.data) as { type?: string };
        if (event.type === 'job.progress' || event.type === 'notification') nudge();
      } catch {
        // A frame this client has no reading of changes nothing.
      }
    };
    source.addEventListener('message', onMessage);
    const stream = source;
    return () => {
      stream.removeEventListener('message', onMessage);
      stream.close();
    };
  }, [nudge]);

  return { runs, error, refetch: read };
}
