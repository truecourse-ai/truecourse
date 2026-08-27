/**
 * The live tail of one agent-sessions run: joins the run's socket room
 * (`joinRun` → the server starts tailing the transcript files) and accumulates
 * the pushed `session:event`s per session plus the latest `session:run-updated`
 * record.
 *
 * Deliberately NOT routed through `useSocket`'s handler map — transcripts are a
 * high-frequency stream, and this hook lets only the Activity view re-render.
 * The subscribe happens on mount, BEFORE the caller's REST snapshot read
 * resolves (subscribe-then-snapshot ordering); overlap between the two
 * is deduped by `seq` where the streams merge (transcript-model's fold input).
 */

import { useEffect, useState } from 'react';
import type { SessionCommand, SessionEvent } from '@truecourse/agent-loop';
import type { PublicSessionRun } from '@/lib/api';
import { connectSocket } from '@/lib/socket';

export interface RunStreamState {
  /** Events pushed since mount, per sessionId, in arrival order. */
  liveEvents: ReadonlyMap<string, readonly SessionEvent[]>;
  /** The latest pushed run record — fresher than any list read while live. */
  liveRun: PublicSessionRun | null;
}

const EMPTY: RunStreamState = { liveEvents: new Map(), liveRun: null };

export function useRunStream(
  repoId: string,
  command: SessionCommand | null,
  runId: string | null,
  enabled: boolean,
): RunStreamState {
  const [state, setState] = useState<RunStreamState>(EMPTY);

  useEffect(() => {
    setState(EMPTY);
    if (!enabled || !command || !runId) return;

    const socket = connectSocket();
    const join = (): void => {
      socket.emit('joinRun', { repoId, command, runId });
    };

    const onEvent = (payload: { repoId: string; runId: string; sessionId: string; event: SessionEvent }): void => {
      if (payload.repoId !== repoId || payload.runId !== runId) return;
      setState((prev) => {
        const next = new Map(prev.liveEvents);
        next.set(payload.sessionId, [...(next.get(payload.sessionId) ?? []), payload.event]);
        return { liveEvents: next, liveRun: prev.liveRun };
      });
    };
    const onRunUpdated = (payload: { repoId: string; runId: string; run: PublicSessionRun }): void => {
      if (payload.repoId !== repoId || payload.runId !== runId) return;
      setState((prev) => ({ liveEvents: prev.liveEvents, liveRun: payload.run }));
    };

    socket.on('session:event', onEvent);
    socket.on('session:run-updated', onRunUpdated);
    // Join now if connected, and again on every (re)connect — a reconnect gets
    // a fresh server-side room membership or the tail silently stops.
    socket.on('connect', join);
    if (socket.connected) join();

    return () => {
      socket.off('session:event', onEvent);
      socket.off('session:run-updated', onRunUpdated);
      socket.off('connect', join);
      if (socket.connected) socket.emit('leaveRun', { repoId, runId });
    };
  }, [repoId, command, runId, enabled]);

  return state;
}
