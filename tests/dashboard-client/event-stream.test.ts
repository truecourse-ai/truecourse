/**
 * The page's one event stream.
 *
 * A browser allows six connections per host across every tab, so the page opens
 * `/api/events` ONCE however many surfaces read it: the first subscriber opens
 * it, each frame is parsed once and handed to everyone, and the last unsubscribe
 * closes it. A runtime without EventSource opens none and subscribing is a no-op.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ServerEvent } from '@truecourse/shared';

const opened: StubEventSource[] = [];

class StubEventSource {
  static CLOSED = 2;
  readyState = 1;
  listeners = new Map<string, Set<(e: MessageEvent<string>) => void>>();
  constructor(
    readonly url: string,
    readonly init?: { withCredentials?: boolean },
  ) {
    opened.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  close() {
    this.readyState = StubEventSource.CLOSED;
  }
  /** Deliver one server frame, as the transport would. */
  deliver(payload: unknown) {
    for (const fn of this.listeners.get('message') ?? []) {
      fn({ data: JSON.stringify(payload) } as MessageEvent<string>);
    }
  }
}

beforeEach(() => {
  opened.length = 0;
  (globalThis as { EventSource?: unknown }).EventSource = StubEventSource;
});

afterEach(() => {
  delete (globalThis as { EventSource?: unknown }).EventSource;
});

/** A fresh module per test: the stream is page state, held in module scope. */
async function subscribeToServerEvents() {
  vi.resetModules();
  return (await import('@/preview/shell/event-stream')).subscribeToServerEvents;
}

const scanned: ServerEvent = {
  type: 'notification',
  notification: {
    id: 'n-1',
    kind: 'context.scan',
    level: 'success',
    title: 'Documents scanned',
    body: null,
    data: null,
    readAt: null,
    createdAt: '2026-09-11T09:05:00.000Z',
  },
  jobId: 'job-1',
};

describe('the page event stream', () => {
  it('opens ONE connection however many subscribers read it', async () => {
    const subscribe = await subscribeToServerEvents();
    const first: ServerEvent[] = [];
    const second: ServerEvent[] = [];
    const third: ServerEvent[] = [];

    const stop = [
      subscribe((e) => first.push(e)),
      subscribe((e) => second.push(e)),
      subscribe((e) => third.push(e)),
    ];

    expect(opened).toHaveLength(1);
    expect(opened[0]!.url.endsWith('/api/events')).toBe(true);
    expect(opened[0]!.init).toEqual({ withCredentials: true });

    // One frame, parsed once, delivered to every subscriber.
    opened[0]!.deliver(scanned);
    expect(first).toEqual([scanned]);
    expect(second).toEqual([scanned]);
    expect(third).toEqual([scanned]);

    for (const unsubscribe of stop) unsubscribe();
  });

  it('closes the connection when the last subscriber leaves, and opens a new one after', async () => {
    const subscribe = await subscribeToServerEvents();
    const seen: ServerEvent[] = [];
    const stopOne = subscribe((e) => seen.push(e));
    const stopTwo = subscribe(() => {});
    const stream = opened[0]!;

    stopTwo();
    expect(stream.readyState).not.toBe(StubEventSource.CLOSED);
    expect(opened).toHaveLength(1);

    stopOne();
    expect(stream.readyState).toBe(StubEventSource.CLOSED);
    // A frame on the closed stream reaches nobody.
    stream.deliver(scanned);
    expect(seen).toEqual([]);

    const stopThree = subscribe((e) => seen.push(e));
    expect(opened).toHaveLength(2);
    opened[1]!.deliver(scanned);
    expect(seen).toEqual([scanned]);
    stopThree();
  });

  it('ignores a frame it cannot read, and keeps delivering the ones it can', async () => {
    const subscribe = await subscribeToServerEvents();
    const seen: ServerEvent[] = [];
    const stop = subscribe((e) => seen.push(e));

    for (const fn of opened[0]!.listeners.get('message') ?? []) {
      fn({ data: 'not json at all' } as MessageEvent<string>);
    }
    opened[0]!.deliver(scanned);

    expect(seen).toEqual([scanned]);
    stop();
  });

  it('opens nothing in a runtime that has no EventSource', async () => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
    const subscribe = await subscribeToServerEvents();

    const stop = subscribe(() => {});
    expect(opened).toEqual([]);
    stop();
  });
});
