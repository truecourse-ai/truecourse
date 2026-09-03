/**
 * The SSE stream: the headers a browser needs to hold the connection open, the
 * workspace scoping that keeps one org's events out of another's stream, and the
 * unsubscribe on disconnect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { ServerEvent } from '@truecourse/shared';
import { createEventsRouter, type EventBackplane } from '@truecourse/jobs';

/** A backplane with no Postgres behind it: `publish` fans out in-process. */
function fakeHub() {
  const conns = new Set<{ orgId: string; res: Response }>();
  const hub: EventBackplane = {
    async start() {},
    async stop() {},
    subscribe(orgId, res) {
      const conn = { orgId, res };
      conns.add(conn);
      return () => conns.delete(conn);
    },
  };
  return {
    hub,
    subscriberCount: () => conns.size,
    publish(org: string, event: ServerEvent) {
      for (const c of conns) if (c.orgId === org) c.res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
  };
}

let server: Server;
let baseUrl: string;
let hub: ReturnType<typeof fakeHub>;

/** The workspace a request acts in, taken from a header so a test can switch. */
const orgIdOf = (req: express.Request): string | null =>
  (req.headers['x-test-org'] as string | undefined) ?? null;

beforeEach(async () => {
  hub = fakeHub();
  const app = express();
  app.use('/api/events', createEventsRouter(hub.hub, orgIdOf));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const note = (title: string): ServerEvent => ({
  type: 'notification',
  jobId: null,
  notification: {
    id: title,
    kind: 'test.job',
    level: 'info',
    title,
    body: null,
    data: null,
    readAt: null,
    createdAt: '2026-09-02T00:00:00.000Z',
  },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

/** Open the stream and return its reader plus a close. */
async function openStream(org: string) {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/events`, {
    headers: { 'x-test-org': org },
    signal: controller.signal,
  });
  const body = res.body;
  if (!body) throw new Error('event stream had no body');
  await settle(); // let the router register the subscription
  return { res, reader: body.getReader(), close: () => controller.abort() };
}

/** Read until one `data:` frame lands. */
async function nextDataFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error('stream closed before a data frame arrived');
    buffer += decoder.decode(value, { stream: true });
    const frame = buffer.split('\n').find((line) => line.startsWith('data: '));
    if (frame) return frame.slice(6);
  }
}

describe('GET /api/events', () => {
  it('401s a caller with no workspace', async () => {
    const res = await fetch(`${baseUrl}/api/events`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'no workspace' });
  });

  it('opens an event stream with the headers that keep it alive', async () => {
    const { res, close } = await openStream('org_A');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    close();
  });

  it('delivers a published event to the subscribed workspace and no other', async () => {
    const { reader, close } = await openStream('org_A');

    // Publish to both orgs — only org_A's event may reach this stream.
    hub.publish('org_B', note('for B'));
    hub.publish('org_A', note('for A'));

    expect(JSON.parse(await nextDataFrame(reader))).toMatchObject({
      notification: { title: 'for A' },
    });
    close();
  });

  it('unsubscribes when the client disconnects', async () => {
    const { close } = await openStream('org_A');
    expect(hub.subscriberCount()).toBe(1);

    close();
    await settle();

    expect(hub.subscriberCount()).toBe(0);
  });
});
