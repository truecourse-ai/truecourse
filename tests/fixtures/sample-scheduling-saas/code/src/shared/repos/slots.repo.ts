import { prisma, type Db } from '../db.js';

/** Availability slots. A slot backs at most one active appointment; booking
 * flips `booked`, and cancel/reschedule flip it back (README — no double-booking). */
export const slotsRepo = {
  findById(id: string, db: Db = prisma) {
    return db.slot.findUnique({ where: { id } });
  },
  openForProvider(providerId: string, from: Date, to: Date, db: Db = prisma) {
    return db.slot.findMany({
      where: { providerId, booked: false, startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: 'asc' },
    });
  },
  setBooked(id: string, booked: boolean, db: Db = prisma) {
    return db.slot.update({ where: { id }, data: { booked } });
  },
};
