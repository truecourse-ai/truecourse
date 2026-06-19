/**
 * The live-event backplane: Postgres `LISTEN/NOTIFY` → per-connection SSE writers.
 *
 * Workers (and routes) `publishEvent()` by `pg_notify`-ing the `tc_events`
 * channel. A single dedicated `pg` client (its own connection, like `lockPool`)
 * LISTENs that channel and fans each event out to the SSE responses registered
 * for the matching workspace org. Because the transport is Postgres, this works
 * unchanged across multiple ee-server replicas: every instance LISTENs, and the
 * one holding a given user's SSE connection delivers the push.
 *
 * `NOTIFY` is NOT durable (a payload with no listener is dropped) — that's fine:
 * the `notifications` table is the source of truth, and clients re-fetch active
 * jobs + unread notifications on (re)connect. This is purely the live layer.
 */

import type { Response } from 'express';
import { Client } from 'pg';
import { sql } from 'drizzle-orm';
import type { EeDb } from '@truecourse/ee-db';
import type { ServerEvent } from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';

const CHANNEL = 'tc_events';

interface SseConn {
  orgId: string;
  res: Response;
}

interface EventEnvelope {
  orgId: string;
  event: ServerEvent;
}

export class EventHub {
  private readonly conns = new Set<SseConn>();
  private client: Client | null = null;
  private stopped = false;

  constructor(private readonly connectionString: string) {}

  /** Open the dedicated LISTEN connection (auto-reconnects on drop). */
  async start(): Promise<void> {
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: this.connectionString });
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const { orgId, event } = JSON.parse(msg.payload) as EventEnvelope;
        this.fanout(orgId, event);
      } catch (err) {
        log.warn(`[ee-jobs] dropping malformed event payload: ${(err as Error).message}`);
      }
    });
    client.on('error', (err) => {
      log.warn(`[ee-jobs] event-hub connection error: ${err.message}`);
      this.client = null;
      if (!this.stopped) setTimeout(() => void this.connect().catch(() => {}), 1000);
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    this.client = client;
    log.info('[ee-jobs] event hub listening on tc_events');
  }

  /** Register an SSE response for an org; returns an unsubscribe fn. */
  subscribe(orgId: string, res: Response): () => void {
    const conn: SseConn = { orgId, res };
    this.conns.add(conn);
    return () => this.conns.delete(conn);
  }

  private fanout(orgId: string, event: ServerEvent): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of this.conns) {
      if (c.orgId !== orgId) continue;
      try {
        c.res.write(frame);
      } catch {
        this.conns.delete(c);
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const c of this.conns) {
      try {
        c.res.end();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    if (this.client) {
      try {
        await this.client.end();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
  }
}

/**
 * Publish one event to all listeners (this + other replicas) via `pg_notify`.
 * Payload must stay under Postgres's 8KB NOTIFY limit — pass IDs + small fields,
 * never large bodies. Best-effort: a publish failure must not fail the job.
 */
export async function publishEvent(db: EeDb, orgId: string, event: ServerEvent): Promise<void> {
  const payload = JSON.stringify({ orgId, event } satisfies EventEnvelope);
  try {
    await db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
  } catch (err) {
    log.warn(`[ee-jobs] pg_notify failed: ${(err as Error).message}`);
  }
}
