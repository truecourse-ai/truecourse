/**
 * Reading one conversation: the journal by page, then the live tail.
 *
 * History is paged (1000 events a request, so a 3000-event journal is three
 * round trips) and the page grows as each one lands, which is why a long
 * conversation paints before it has finished loading. When the work is still
 * going, the stream opens FROM the cursor the last page reached and appends;
 * chunks merge into the one event array, deduped by cursor, so a replayed
 * overlap can never double a line.
 *
 * A repository whose store predates the journal (file mode) has no cursor to
 * page: its record names its work, and each piece of work has a transcript of
 * its own. Those are read and stitched into the same event shape, so the fold
 * below is the same fold.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityEvent, ActivityProgress } from '@truecourse/shared/activity-stream';
import * as api from '@/lib/api';
import type { PublicSessionRun } from '@/lib/api';
import { followActivity } from '@/lib/activity-stream';
import { getServerUrl } from '@/lib/server-url';
import { foldConversation, type Conversation } from './conversation-model';

const PAGE = 1000;

/** Event types that end whatever the live line was saying about a turn. */
const SETTLES_A_TURN = new Set(['assistant-turn', 'tool-result', 'outcome', 'failure']);

export interface RunConversationState {
  conversation: Conversation;
  /** History is still arriving. Lines already read render underneath it. */
  loading: boolean;
  error: string | null;
  /** The live tail dropped, in the words the reader gets at the bottom. */
  connectionError: string | null;
}

export function useRunConversation(run: PublicSessionRun, repoId: string): RunConversationState {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [progress, setProgress] = useState<ActivityProgress>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // The record moves while the reader watches (a step lands, a status flips).
  // Held in a ref so a fresh record never restarts the read.
  const latest = useRef(run);
  latest.current = run;

  const { command, runId, activityStream } = run;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setEvents([]);
    setProgress({});
    setLoading(true);
    setError(null);
    setConnectionError(null);

    const absorb = (arriving: readonly ActivityEvent[]): void => {
      if (arriving.length === 0) return;
      // A partial turn is superseded the moment its finished form arrives, and
      // a record that says the work is over ends every live line at once. The
      // stream does not re-send an empty progress map to say so.
      setProgress((prev) => {
        let next = prev;
        for (const event of arriving) {
          if (event.kind === 'run') {
            if (event.run.status !== 'running') next = {};
          } else if (SETTLES_A_TURN.has(event.event.type)) {
            if (next[event.sessionId]) {
              next = { ...next };
              delete next[event.sessionId];
            }
          }
        }
        return next;
      });
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.cursor));
        const next = [...prev];
        for (const event of arriving) {
          if (seen.has(event.cursor)) continue;
          seen.add(event.cursor);
          next.push(event);
        }
        return next.length === prev.length ? prev : next.sort((a, b) => a.cursor - b.cursor);
      });
    };

    const read = async (): Promise<void> => {
      if (!activityStream) {
        absorb(await readTranscripts(repoId, latest.current));
        return;
      }
      let after = -1;
      for (;;) {
        const page = await api.readRunActivity(repoId, command, runId, after, PAGE);
        if (cancelled) return;
        absorb(page.events);
        after = page.nextCursor;
        if (page.done) break;
      }
      if (cancelled || latest.current.status !== 'running') return;
      void followActivity({
        url: `${getServerUrl()}/api/repos/${encodeURIComponent(repoId)}/sessions/runs/${command}/${encodeURIComponent(runId)}/stream`,
        runId,
        from: after,
        signal: controller.signal,
        onEvent: (event) => absorb([event]),
        onProgress: (next) => setProgress(next),
        onConnection: (message) => {
          if (!controller.signal.aborted) setConnectionError(message);
        },
      });
    };

    read()
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // The record itself is deliberately not a dependency: it changes on every
    // write, and the journal it names does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, command, runId, activityStream]);

  // Folded on the events array's identity: absorbing nothing new keeps the
  // previous array, so a heartbeat re-render costs nothing.
  const conversation = useMemo(
    () => foldConversation(run, events, progress),
    [run, events, progress],
  );

  return { conversation, loading, error, connectionError };
}

/**
 * A store with no journal, in journal shape: the record first, then each piece
 * of work's transcript in the order the record lists it. Cursors are minted
 * here and mean only "this came before that", which is all the fold reads.
 */
async function readTranscripts(
  repoId: string,
  run: PublicSessionRun,
): Promise<ActivityEvent[]> {
  const events: ActivityEvent[] = [{ cursor: 0, kind: 'run', run }];
  let cursor = 1;
  const transcripts = await Promise.all(
    run.sessions.map((entry) =>
      api
        .getSessionTranscript(repoId, run.command, run.runId, entry.sessionId)
        .then((res) => ({ sessionId: entry.sessionId, events: res.events }))
        .catch(() => ({ sessionId: entry.sessionId, events: [] })),
    ),
  );
  for (const transcript of transcripts) {
    for (const event of transcript.events) {
      events.push({ cursor: cursor++, kind: 'session-event', sessionId: transcript.sessionId, event });
    }
  }
  return events;
}
