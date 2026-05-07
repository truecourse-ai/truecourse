import type { Order, OrderStatus, PageOf } from '../types.js';

const store = new Map<string, Order>();

export const ordersRepo = {
  async insert(o: Order): Promise<void> {
    store.set(o.id, o);
  },
  async update(o: Order): Promise<void> {
    store.set(o.id, o);
  },
  async findById(id: string): Promise<Order | null> {
    return store.get(id) ?? null;
  },
  async list(opts: {
    cursor?: string;
    offset?: number;
    limit: number;
    status?: OrderStatus;
  }): Promise<PageOf<Order>> {
    const all = [...store.values()]
      .filter((o) => (opts.status ? o.status === opts.status : true))
      .sort((a, b) => b.placedAt.localeCompare(a.placedAt));
    const startIdx = opts.offset ?? (opts.cursor ? Number(Buffer.from(opts.cursor, 'base64').toString('utf-8')) : 0);
    const slice = all.slice(startIdx, startIdx + opts.limit);
    const next =
      startIdx + slice.length < all.length
        ? Buffer.from(String(startIdx + slice.length)).toString('base64')
        : null;
    return { items: slice, nextCursor: next };
  },
  /** Lease-recovery hook — used by the background worker to reset crashed in-flight steps. */
  async resetForRecovery(o: Order): Promise<void> {
    store.set(o.id, o);
  },
};
