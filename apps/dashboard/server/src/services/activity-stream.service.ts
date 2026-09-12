import type { UIMessageChunk } from 'ai';
import type { ActivityEvent } from '@truecourse/shared/activity-stream';
import { readActivityProgress, subscribeActivity } from '@truecourse/core/lib/activity-journal';
import { readStoredActivityPage, type SessionRunStore } from '@truecourse/core/lib/sessions-store';

/** Replay once, then deliver published events directly, independently of the job. */
export function createActivityStream(
  run: SessionRunStore,
  after: number,
  signal: AbortSignal,
): ReadableStream<UIMessageChunk> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const iterator = chunks(run, after, controller.signal);
  return new ReadableStream({
    async pull(sink) {
      try {
        const next = await iterator.next();
        if (next.done) { signal.removeEventListener('abort', abort); sink.close(); }
        else sink.enqueue(next.value);
      } catch (error) { signal.removeEventListener('abort', abort); sink.error(error); }
    },
    async cancel() { abort(); signal.removeEventListener('abort', abort); await iterator.return(undefined); },
  });
}

async function* chunks(run: SessionRunStore, after: number, signal: AbortSignal): AsyncGenerator<UIMessageChunk> {
  let changed = false;
  let replay = true;
  let pending: ActivityEvent[] = [];
  let wake: (() => void) | undefined;
  const notify = (event?: ActivityEvent) => {
    changed = true;
    if (event && !replay) {
      pending.push(event);
      // A slow viewer catches up from its cursor instead of retaining an
      // unbounded queue. Normal live delivery never reads back from disk.
      if (pending.length > 128) { pending = []; replay = true; }
    }
    wake?.();
  };
  const abort = () => notify();
  // Subscribe before replay. A write during a yielded history batch wakes the next read.
  const unsubscribe = subscribeActivity(run.dir, notify);
  const unsubscribeRemote = run.subscribeActivity?.(() => { replay = true; notify(); });
  signal.addEventListener('abort', abort, { once: true });
  let heartbeatDue = false;
  // Keep catch-up periodic even while local progress continuously wakes the stream.
  const heartbeat = setInterval(() => {
    if (run.readActivity) replay = true;
    heartbeatDue = true;
    notify();
  }, 15_000);
  let terminal = run.record().status !== 'running';
  try {
    yield { type: 'start', messageId: run.runId };
    while (!signal.aborted) {
      changed = false;
      let batch: ActivityEvent[];
      if (replay) {
        // Enable live queuing before awaiting storage, so a commit during the
        // history query is either replayed or queued, never dropped.
        replay = false;
        const page = await readStoredActivityPage(run, after, 128, true);
        batch = page.events;
        if (!page.done) replay = true;
      } else { batch = pending; pending = []; }
      for (const event of batch) {
        if (signal.aborted) return;
        if (event.cursor <= after) continue;
        after = event.cursor;
        if (event.kind === 'run') terminal = event.run.status !== 'running';
        yield { type: 'data-activity', id: `${run.runId}:${event.cursor}`, data: event };
      }
      if (replay || pending.length > 0) continue;
      yield { type: 'data-progress', data: readActivityProgress(run.dir), transient: true };
      if (changed) continue;
      if (terminal) { yield { type: 'finish', finishReason: 'stop' }; return; }
      if (heartbeatDue) {
        heartbeatDue = false;
        yield { type: 'data-heartbeat', data: { at: new Date().toISOString() }, transient: true };
        if (changed) continue;
      }
      await new Promise<void>(resolve => {
        wake = () => { wake = undefined; resolve(); };
        if (signal.aborted) wake();
      });
    }
  } finally { clearInterval(heartbeat); unsubscribeRemote?.(); unsubscribe(); signal.removeEventListener('abort', abort); wake?.(); }
}
