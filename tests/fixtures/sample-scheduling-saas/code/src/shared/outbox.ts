import { EventEmitter } from 'node:events';
import { type Prisma } from '@prisma/client';
import { prisma, type Db } from './db.js';

/**
 * In-process stand-in for the message bus (ADR 0002). A real deployment
 * publishes to a broker; the relay below emits here.
 */
export const bus = new EventEmitter();

/**
 * Append a domain event to the outbox using the CALLER'S transaction, so the
 * state change and the event row commit together (ADR 0002). Pass the `tx`
 * from `prisma.$transaction`.
 */
export async function recordEvent(
  db: Db,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.outboxEvent.create({
    data: { type, payload: payload as Prisma.InputJsonValue },
  });
}

/**
 * Relay: publish committed-but-unpublished events to the bus, then mark them
 * published. Delivery is at-least-once, so consumers must be idempotent
 * (ADR 0002). Safe to run repeatedly; returns how many it published.
 */
export async function relayOutbox(): Promise<number> {
  const pending = await prisma.outboxEvent.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  for (const event of pending) {
    bus.emit(event.type, event.payload);
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { publishedAt: new Date() },
    });
  }
  return pending.length;
}
