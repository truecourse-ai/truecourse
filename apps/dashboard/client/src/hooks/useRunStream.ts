/**
 * One run's history and live updates. Dashboard Spec scans use the AI SDK
 * stream with cursor replay; older runs and other commands join the existing
 * socket room. The returned shapes keep the current Activity components intact.
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
import { followActivity } from '@/lib/activity-stream';
import { getServerUrl } from '@/lib/server-url';
import type { ActivityEvent, ActivityProgress } from '@truecourse/shared/activity-stream';

export interface RunStreamState {
  /** Events pushed since mount, per sessionId, in arrival order. */
  liveEvents: ReadonlyMap<string, readonly SessionEvent[]>;
  /** The latest pushed run record — fresher than any list read while live. */
  liveRun: PublicSessionRun | null;
  connectionError: string | null;
  progress: ActivityProgress;
}

const EMPTY: RunStreamState = { liveEvents: new Map(), liveRun: null, connectionError: null, progress: {} };

export function useRunStream(
  repoId: string,
  command: SessionCommand | null,
  runId: string | null,
  enabled: boolean,
  activityStream = false,
): RunStreamState {
  const [state, setState] = useState<RunStreamState>(EMPTY);

  useEffect(() => {
    setState(EMPTY);
    if (!enabled || !command || !runId) return;

    if (activityStream) {
      const controller = new AbortController();
      let frame: number | undefined;
      let pending: Array<ActivityEvent | { kind: 'progress'; progress: ActivityProgress }> = [];
      const flush = () => {
        frame = undefined;
        const events = pending;
        pending = [];
        if (controller.signal.aborted) return;
        setState(prev => {
          const liveEvents = new Map(prev.liveEvents);
          let liveRun = prev.liveRun;
          let progress = prev.progress;
          const additions = new Map<string, SessionEvent[]>();
          for (const event of events) {
            if (event.kind === 'progress') progress = event.progress;
            else if (event.kind === 'run') {
              liveRun = event.run;
              if (liveRun.status !== 'running') progress = {};
            }
            else {
              if (['assistant-turn', 'tool-result', 'outcome', 'failure'].includes(event.event.type)) {
                progress = { ...progress }; delete progress[event.sessionId];
              }
              const batch = additions.get(event.sessionId) ?? [];
              batch.push(event.event);
              additions.set(event.sessionId, batch);
            }
          }
          for (const [sessionId, batch] of additions) {
            const merged = new Map((liveEvents.get(sessionId) ?? []).map(event => [event.seq, event]));
            for (const event of batch) merged.set(event.seq, event);
            liveEvents.set(sessionId, [...merged.values()].sort((a, b) => a.seq - b.seq));
          }
          return { ...prev, liveRun, liveEvents, progress };
        });
      };
      void followActivity({
        url: `${getServerUrl()}/api/repos/${encodeURIComponent(repoId)}/sessions/runs/${command}/${encodeURIComponent(runId)}/stream`,
        runId, signal: controller.signal,
        onEvent: event => { pending.push(event); frame ??= requestAnimationFrame(flush); },
        onProgress: progress => { pending.push({ kind: 'progress', progress }); frame ??= requestAnimationFrame(flush); },
        onConnection: connectionError => {
          if (!controller.signal.aborted) setState(prev => prev.connectionError === connectionError ? prev : { ...prev, connectionError });
        },
      });
      return () => { controller.abort(); if (frame !== undefined) cancelAnimationFrame(frame); };
    }

    const socket = connectSocket();
    const join = (): void => {
      socket.emit('joinRun', { repoId, command, runId });
    };

    const onEvent = (payload: { repoId: string; runId: string; sessionId: string; event: SessionEvent }): void => {
      if (payload.repoId !== repoId || payload.runId !== runId) return;
      setState((prev) => {
        const next = new Map(prev.liveEvents);
        next.set(payload.sessionId, [...(next.get(payload.sessionId) ?? []), payload.event]);
        return { ...prev, liveEvents: next };
      });
    };
    const onRunUpdated = (payload: { repoId: string; runId: string; run: PublicSessionRun }): void => {
      if (payload.repoId !== repoId || payload.runId !== runId) return;
      setState((prev) => ({ ...prev, liveRun: payload.run }));
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
  }, [repoId, command, runId, enabled, activityStream]);

  return state;
}
