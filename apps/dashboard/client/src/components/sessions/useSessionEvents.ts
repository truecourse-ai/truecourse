/**
 * One session's transcript, snapshot + live tail merged.
 *
 * Lives beside the Activity components rather than in `hooks/` because it is
 * the sessions surface's own plumbing: the REST snapshot off the sessions
 * route, deduped against the socket-pushed events `useRunStream` already
 * accumulates for the run (§3.9's subscribe-then-snapshot ordering).
 *
 * `enabled` is what keeps a collapsed session line from fetching — a run with
 * a hundred curate sessions reads none of them until one is opened. A
 * `waiting` session is the exception the Activity view makes: its question is
 * a message in the stream, so its transcript loads unopened.
 */

import { useEffect, useState } from 'react';
import type { SessionCommand, SessionEvent } from '@truecourse/agent-loop';
import * as api from '@/lib/api';
import { mergeEvents } from './transcript-model';

export interface SessionEventsState {
  /** Snapshot + live, ordered by `seq`. Empty while the snapshot is in flight. */
  events: SessionEvent[];
  loading: boolean;
  error: string | null;
}

export function useSessionEvents(
  repoId: string,
  command: SessionCommand,
  runId: string,
  sessionId: string,
  liveEvents: readonly SessionEvent[],
  enabled: boolean,
): SessionEventsState {
  const [snapshot, setSnapshot] = useState<SessionEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setSnapshot(null);
    setError(null);
    api
      .getSessionTranscript(repoId, command, runId, sessionId)
      .then((res) => {
        if (!cancelled) setSnapshot(res.events);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, command, runId, sessionId, enabled]);

  return {
    events: enabled ? mergeEvents(snapshot ?? [], liveEvents) : [],
    loading: enabled && snapshot === null && error === null,
    error,
  };
}
