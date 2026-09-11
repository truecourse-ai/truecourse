// PREVIEW: REAL. The workspace's Context, read from the server and kept current.

/**
 * What every Context surface reads, and the one signal that makes it move.
 *
 * A Context mutation is workspace-wide (a source added, a sync that reconciled
 * something, a link made or dropped), so the server announces it as
 * `context.changed` on the SSE stream the workspace already holds open — the
 * same stream the Agent page reads job progress from. One subscription here
 * bumps a counter, debounced, and every reader below re-reads on it. No
 * polling, and no repo socket room: Context belongs to no repository.
 *
 * Degrades to nothing: with no server behind the page the reads fail quietly
 * and each hook reports the failure rather than inventing an empty workspace.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextDocumentRow, ContextSourceView, ContextSyncRecord } from '@truecourse/shared';
import {
  getContextSource,
  getContextStaleness,
  listContextDocuments,
  listContextSources,
} from '@/lib/api';
import { getServerUrl } from '@/lib/server-url';

/** How long a signal waits for its neighbours before the reads run. */
const DEBOUNCE_MS = 300;

/**
 * A counter that bumps whenever the workspace's Context may have moved: its own
 * change event, and the job stream's progress and notifications (a sync and a
 * scan are jobs, and their end is what a source's status turns on).
 */
export function useContextSignal(): number {
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nudge = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setTick((n) => n + 1);
    }, DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

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
        if (
          event.type === 'context.changed' ||
          event.type === 'job.progress' ||
          event.type === 'notification'
        ) {
          nudge();
        }
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

  return tick;
}

/** One read's state: null until the first answer lands — loading, not empty. */
interface Read<T> {
  data: T | null;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * The shared body of every reader below: read, re-read on the signal, forget on
 * unmount. `key` is what the read is ABOUT (a source id) when a page reads one
 * thing at a time: changing it re-reads, the way changing the signal does.
 */
function useRead<T>(read: () => Promise<T>, signal: number, key = ''): Read<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const fn = useRef(read);
  fn.current = read;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    try {
      const next = await fn.current();
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run, signal, key]);

  return { data, error, refetch: run };
}

export interface ContextSourcesState {
  /** null until the first read lands. */
  sources: ContextSourceView[] | null;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useContextSources(signal: number): ContextSourcesState {
  const read = useRead(async () => (await listContextSources()).sources, signal);
  return { sources: read.data, error: read.error, refetch: read.refetch };
}

export interface ContextSourceState {
  /** null until the first read lands, and for a source this workspace has not. */
  source: ContextSourceView | null;
  /** The source's syncs, newest first; empty until the read lands. */
  syncs: ContextSyncRecord[];
  error: string | null;
  refetch: () => Promise<void>;
}

/** ONE source, with the syncs behind it — the source page's whole read. */
export function useContextSource(sourceId: string, signal: number): ContextSourceState {
  const read = useRead(() => getContextSource(sourceId), signal, sourceId);
  return {
    source: read.data?.source ?? null,
    syncs: read.data?.syncs ?? [],
    error: read.error,
    refetch: read.refetch,
  };
}

export interface ContextDocumentsState {
  /** null until the first read lands. */
  documents: ContextDocumentRow[] | null;
  /** When the corpus the rows come from was built; null before the first scan. */
  corpusAt: string | null;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useContextDocuments(signal: number): ContextDocumentsState {
  const read = useRead(() => listContextDocuments(), signal);
  return {
    documents: read.data?.documents ?? null,
    corpusAt: read.data?.corpusAt ?? null,
    error: read.error,
    refetch: read.refetch,
  };
}

/** Whether the Context has moved since the corpus was built — the Scan dot. */
export function useContextStaleness(signal: number): boolean {
  const read = useRead(() => getContextStaleness(), signal);
  return read.data?.stale ?? false;
}
