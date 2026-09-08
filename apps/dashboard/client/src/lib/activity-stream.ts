import { DefaultChatTransport } from 'ai';
import { ActivityEventSchema, ActivityProgressSchema, type ActivityEvent, type ActivityMessage, type ActivityProgress } from '@truecourse/shared/activity-stream';

class ActivityAccessError extends Error {}

/** SDK owns SSE decoding. This adapter only owns the run cursor and connection lifetime. */
export async function followActivity({
  url, runId, signal, onEvent, onProgress, onConnection, fetcher = fetch,
}: {
  url: string;
  runId: string;
  signal: AbortSignal;
  onEvent: (event: ActivityEvent) => void;
  onProgress?: (progress: ActivityProgress) => void;
  onConnection: (error: string | null) => void;
  fetcher?: typeof fetch;
}): Promise<void> {
  let after = -1;
  let retry = 0;
  while (!signal.aborted) {
    let reader: ReadableStreamDefaultReader<import('ai').UIMessageChunk> | undefined;
    try {
      const transport = new DefaultChatTransport<ActivityMessage>({
        credentials: 'include',
        // SDK reconnect requests do not expose a signal; scope their fetch to this viewer.
        fetch: async (input, init) => {
          const response = await fetcher(input, { ...init, signal });
          if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
            await response.body?.cancel();
            throw new ActivityAccessError(response.status === 401 || response.status === 403
              ? 'Activity access was denied. Sign in again or check repository access.'
              : 'Activity could not be reopened. Refresh the page to reload this run.');
          }
          return response;
        },
        prepareReconnectToStreamRequest: () => ({ api: `${url}?after=${after}` }),
      });
      const stream = await transport.reconnectToStream({ chatId: runId });
      if (!stream) throw new Error('The activity stream is unavailable');
      reader = stream.getReader();
      let finished = false;
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === 'error') throw new Error(value.errorText);
        if (value.type === 'data-activity') {
          const event = ActivityEventSchema.parse(value.data);
          if (event.cursor > after) { onEvent(event); after = event.cursor; }
          retry = 0;
          onConnection(null);
        } else if (value.type === 'data-progress') {
          onProgress?.(ActivityProgressSchema.parse(value.data));
        } else if (value.type === 'data-heartbeat') {
          retry = 0; onConnection(null);
        } else if (value.type === 'finish') finished = true;
      }
      if (finished) { onConnection(null); return; }
      if (!signal.aborted) throw new Error('Connection interrupted');
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ActivityAccessError) { onConnection(error.message); return; }
      onConnection('Activity connection interrupted. Reconnecting and catching up…');
    } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    if (signal.aborted) return;
    const delay = Math.min(1000 * 2 ** Math.min(retry++, 4), 15_000);
    await new Promise<void>(resolve => {
      const abort = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
    });
  }
}
