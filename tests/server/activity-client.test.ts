import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai';
import { followActivity } from '../../apps/dashboard/client/src/lib/activity-stream';
import type { ActivityEvent } from '@truecourse/shared/activity-stream';

const initial: ActivityEvent = { kind: 'run', cursor: 0, run: {
  command: 'spec-scan', runId: 'r1', gitRef: 'abc', startedAt: '2026-09-07T10:00:00Z', status: 'running', sessions: [], activityStream: 'ai-sdk-v1',
} };
const next: ActivityEvent = { kind: 'session-event', cursor: 200, sessionId: 's1', event: { type: 'user-message', content: 'Read docs', seq: 0, ts: '2026-09-07T10:00:01Z' } };
const chunk = (data: ActivityEvent): UIMessageChunk => ({ type: 'data-activity', id: `r1:${data.cursor}`, data });
const response = (...chunks: UIMessageChunk[]) => createUIMessageStreamResponse({ stream: new ReadableStream({ start(c) { chunks.forEach(x => c.enqueue(x)); c.close(); } }) });

afterEach(() => vi.useRealTimers());

describe('SDK activity client', () => {
  it('resumes an interrupted stream from the last applied cursor and ignores replay overlap', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ type: 'start', messageId: 'r1' }, chunk(initial)))
      .mockResolvedValueOnce(response({ type: 'start', messageId: 'r1' }, chunk(initial), chunk(next), { type: 'finish', finishReason: 'stop' }));
    const events: ActivityEvent[] = [];
    let disconnected!: () => void;
    const gap = new Promise<void>(resolve => { disconnected = resolve; });
    const controller = new AbortController();
    const done = followActivity({ url: '/stream', runId: 'r1', signal: controller.signal, fetcher,
      onEvent: e => events.push(e), onConnection: e => { if (e) disconnected(); },
    });
    await gap;
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/stream?after=-1', '/stream?after=0']);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', signal: controller.signal, method: 'GET' });
    expect(events).toEqual([initial, next]);
  });

  it('cancels reconnect delay on viewer unmount', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const controller = new AbortController();
    let disconnected!: () => void;
    const gap = new Promise<void>(resolve => { disconnected = resolve; });
    const done = followActivity({ url: '/stream', runId: 'r1', signal: controller.signal, fetcher,
      onEvent: () => {}, onConnection: error => { if (error) disconnected(); },
    });
    await gap; controller.abort(); await done;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not retry denied access and keeps transient progress outside history', async () => {
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 }));
    const errors: Array<string | null> = [];
    await followActivity({ url: '/stream', runId: 'r1', signal: new AbortController().signal, fetcher: denied, onEvent: () => {}, onConnection: e => errors.push(e) });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(errors.at(-1)).toContain('access was denied');
    const progress: unknown[] = [];
    const events: unknown[] = [];
    await followActivity({ url: '/stream', runId: 'r1', signal: new AbortController().signal,
      fetcher: async () => response(chunk(initial), { type: 'data-progress', data: { s1: { kind: 'text', turnId: 'm1', text: 'Reading' } }, transient: true }, { type: 'finish', finishReason: 'stop' }),
      onEvent: e => events.push(e), onProgress: p => progress.push(p), onConnection: () => {},
    });
    expect(events).toEqual([initial]);
    expect(progress).toEqual([{ s1: { kind: 'text', turnId: 'm1', text: 'Reading' } }]);
  });
});
