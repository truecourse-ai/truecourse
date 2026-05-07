import type { Customer, PageOf } from '../types.js';

const store = new Map<string, Customer>();
const byEmail = new Map<string, string>(); // email → id

export const customersRepo = {
  async insert(c: Customer): Promise<void> {
    store.set(c.id, c);
    byEmail.set(c.email, c.id);
  },
  async findById(id: string): Promise<Customer | null> {
    return store.get(id) ?? null;
  },
  async findByEmail(email: string): Promise<Customer | null> {
    const id = byEmail.get(email);
    return id ? store.get(id) ?? null : null;
  },
  async list(opts: { cursor?: string; limit: number }): Promise<PageOf<Customer>> {
    const all = [...store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const startIdx = opts.cursor ? Number(Buffer.from(opts.cursor, 'base64').toString('utf-8')) : 0;
    const slice = all.slice(startIdx, startIdx + opts.limit);
    const next =
      startIdx + slice.length < all.length
        ? Buffer.from(String(startIdx + slice.length)).toString('base64')
        : null;
    return { items: slice, nextCursor: next };
  },
};
