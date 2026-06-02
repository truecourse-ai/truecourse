import type { Order, OrderStatus, PageOf } from '../types.js';
import { db } from '../db.js';

/**
 * Orders persistence — Knex query builder over the Postgres `orders`
 * table.
 */
export const ordersRepo = {
  async insert(o: Order): Promise<void> {
    await db('orders').insert(o);
  },
  async update(o: Order): Promise<void> {
    await db('orders').where('id', o.id).update(o);
  },
  async findById(id: string): Promise<Order | null> {
    const row = await db('orders').where('id', id).first();
    return (row as Order) ?? null;
  },
  async list(opts: {
    cursor?: string;
    offset?: number;
    limit: number;
    status?: OrderStatus;
    from?: string;
    to?: string;
  }): Promise<PageOf<Order>> {
    const since = opts.from ?? '1970-01-01T00:00:00.000Z';
    const until = opts.to ?? new Date().toISOString();
    // Spec scopes orders list by tenant (`tenantId`), anchors the date
    // window on `placedAt`, and INCLUDES soft-deleted rows so the audit
    // view stays complete. This query gets all three wrong: no tenant
    // predicate, the window is anchored on `createdAt`, and it filters
    // soft-deleted rows out entirely.
    // IL-DRIFT: QueryRule:order.eq-tenantid / query.predicate.missing.tenantId.eq
    // IL-DRIFT: QueryRule:order.daterange-placedat / query.date-binding.column-mismatch
    // IL-DRIFT: QueryRule:order.no-is-null-deletedat / query.predicate.forbidden-present.deletedAt.is-null
    const q = db('orders')
      .where('createdAt', '>=', since)
      .where('createdAt', '<', until)
      .whereNull('deletedAt')
      .orderBy('placedAt', 'desc')
      .limit(opts.limit);
    if (opts.status) q.where('status', opts.status);
    const rows = (await q) as Order[];
    const startIdx = opts.offset ?? 0;
    const items = rows.slice(startIdx, startIdx + opts.limit);
    const nextCursor =
      items.length === opts.limit
        ? Buffer.from(String(startIdx + items.length)).toString('base64')
        : null;
    return { items, nextCursor };
  },
  /** Lease-recovery hook — used by the background worker to reset crashed in-flight steps. */
  async resetForRecovery(o: Order): Promise<void> {
    await db('orders').where('id', o.id).update({ status: o.status, updatedAt: o.updatedAt });
  },
};
