/**
 * Reading one conversation: the run record supplies the work list, and only
 * the opened piece of work loads its messages, one transcript page at a time
 * (older pages on demand, newer ones by polling while it runs).
 *
 * A run of the WORKSPACE (a Document scan, which reads every source and clones
 * nothing) belongs to no repository: `repoId` is null and the same transcript
 * is read by run id alone, under `/api/sessions`. One reader, two addresses.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityEvent } from '@truecourse/shared/activity-stream';
import type { SessionEvent, SessionProgress } from '@truecourse/agent-loop';
import * as api from '@/lib/api';
import type { PublicSessionRun } from '@/lib/api';
import { foldConversation, type Conversation } from './conversation-model';

/** One transcript page, at the repository's address or the workspace's. */
function readPage(
  repoId: string | null,
  command: PublicSessionRun['command'],
  runId: string,
  sessionId: string,
  options: { before?: number; since?: number },
  signal: AbortSignal,
) {
  return repoId
    ? api.getSessionTranscriptPage(repoId, command, runId, sessionId, options, signal)
    : api.getWorkspaceSessionTranscriptPage(runId, sessionId, options, signal);
}

export interface RunConversationState {
  conversation: Conversation;
  loading: boolean;
  error: string | null;
  connectionError: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
}

export function useRunConversation(
  run: PublicSessionRun,
  repoId: string | null,
  sessionId: string | null,
): RunConversationState {
  const [history, setHistory] = useState<{ key: string; events: SessionEvent[] }>({ key: '', events: [] });
  const [progress, setProgress] = useState<SessionProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(run);
  latest.current = run;
  const older = useRef<() => void>(() => {});
  const { command, runId } = run;
  const key = `${repoId}:${command}:${runId}:${sessionId ?? ''}`;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let events: SessionEvent[] = [];
    let olderPending = false;
    setHistory({ key, events });
    setLoading(!!sessionId);
    setLoadingOlder(false);
    setHasOlder(false);
    setProgress(null);
    setError(null);
    older.current = () => {};
    if (!sessionId) return () => controller.abort();

    const absorb = (incoming: SessionEvent[]) => {
      const bySeq = new Map(events.map(e => [e.seq, e]));
      for (const e of incoming) bySeq.set(e.seq, e);
      events = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
      setHistory({ key, events });
    };
    const failed = (e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    };
    const poll = async (initial = false) => {
      try {
        let since = initial ? undefined : events.at(-1)?.seq ?? -1;
        for (;;) {
          const page = await readPage(repoId, command, runId, sessionId,
            since === undefined ? {} : { since }, controller.signal);
          if (controller.signal.aborted) return;
          absorb(page.events);
          setProgress(page.progress ?? null);
          setError(null);
          if (initial) { setHasOlder(page.hasMore); break; }
          if (!page.hasMore || !page.events.length) break;
          since = page.events.at(-1)!.seq;
        }
      } catch (e) { failed(e); }
      finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          // Sequential incremental polling never transfers siblings or overlaps requests.
          const entry = latest.current.sessions.find(s => s.sessionId === sessionId);
          if (entry?.status === 'running' || entry?.status === 'waiting' || (!entry && latest.current.status === 'running'))
            timer = setTimeout(() => { void poll(); }, 3000);
        }
      }
    };
    older.current = () => {
      if (olderPending || !events.length || controller.signal.aborted) return;
      olderPending = true;
      setLoadingOlder(true);
      void readPage(repoId, command, runId, sessionId, { before: events[0].seq }, controller.signal)
        .then(page => {
          if (controller.signal.aborted) return;
          absorb(page.events);
          setHasOlder(page.hasMore);
          setError(null);
        }).catch(failed).finally(() => {
          olderPending = false;
          if (!controller.signal.aborted) setLoadingOlder(false);
        });
    };
    void poll(true);
    return () => { controller.abort(); clearTimeout(timer); older.current = () => {}; };
  }, [repoId, command, runId, sessionId, key]);

  const conversation = useMemo(() => {
    const events: ActivityEvent[] = history.key === key && sessionId
      ? history.events.map(e => ({ cursor: e.seq, kind: 'session-event', sessionId, event: e })) : [];
    return foldConversation(run, events, history.key === key && sessionId && progress ? { [sessionId]: progress } : {});
  }, [run, history, key, sessionId, progress]);
  return { conversation, loading, error, connectionError: null, hasOlder, loadingOlder, loadOlder: () => older.current() };
}
