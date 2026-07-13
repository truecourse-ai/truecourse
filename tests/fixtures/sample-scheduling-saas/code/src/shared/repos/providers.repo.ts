import { prisma, type Db } from '../db.js';

/** Provider reads — the booking app lists providers; both apps resolve them. */
export const providersRepo = {
  list(db: Db = prisma) {
    return db.provider.findMany({ orderBy: { name: 'asc' } });
  },
  findById(id: string, db: Db = prisma) {
    return db.provider.findUnique({ where: { id } });
  },
};
