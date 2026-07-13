import { prisma, type Db } from '../db.js';

/** Customer reads — the ops console resolves a customer when an agent books
 * on their behalf. */
export const customersRepo = {
  findById(id: string, db: Db = prisma) {
    return db.customer.findUnique({ where: { id } });
  },
  list(db: Db = prisma) {
    return db.customer.findMany({ orderBy: { name: 'asc' } });
  },
};
