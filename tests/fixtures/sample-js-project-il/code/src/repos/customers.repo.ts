import type { Customer, PageOf } from '../types.js';
import { prisma } from '../db.js';

/**
 * Customers persistence — Prisma client over the Postgres `Customer`
 * model (see prisma/schema.prisma).
 */
// ADR-001 fixes Postgres as the system of record, but `mongoose` is also
// declared in package.json from a half-finished migration — a forbidden
// data-store alternative.
// IL-DRIFT: ArchitectureDecision:data-store.postgres / architecture.data-store.forbidden-alternative
export const customersRepo = {
  async insert(c: Customer): Promise<void> {
    await prisma.customer.create({ data: c });
  },
  async findById(id: string): Promise<Customer | null> {
    const row = await prisma.customer.findUnique({ where: { id } });
    return (row as Customer) ?? null;
  },
  async findByEmail(email: string): Promise<Customer | null> {
    const row = await prisma.customer.findFirst({ where: { email } });
    return (row as Customer) ?? null;
  },
  async list(opts: { cursor?: string; limit: number }): Promise<PageOf<Customer>> {
    // Spec allows listing customers in the `active` OR `pending` states.
    // This filter only admits `active`, silently hiding every pending
    // signup from the list view.
    // IL-DRIFT: QueryRule:customer.in-status / query.predicate.value-mismatch.status.in
    const items = (await prisma.customer.findMany({
      where: { status: { in: ['active'] } },
      orderBy: { createdAt: 'desc' },
      take: opts.limit,
    })) as Customer[];
    return { items, nextCursor: null };
  },
};
