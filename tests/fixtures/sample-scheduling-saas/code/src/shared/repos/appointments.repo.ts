import type { Appointment, Prisma } from '@prisma/client';
import { prisma, type Db } from '../db.js';
import type { PageOf } from '../types.js';

export interface AppointmentFilters {
  providerId?: string;
  customerId?: string;
  status?: string;
  from?: Date;
  to?: Date;
}

/** Appointment persistence — the shared entity both apps read and write. */
export const appointmentsRepo = {
  findById(id: string, db: Db = prisma) {
    return db.appointment.findUnique({ where: { id } });
  },

  create(data: Prisma.AppointmentUncheckedCreateInput, db: Db = prisma) {
    return db.appointment.create({ data });
  },

  update(id: string, data: Prisma.AppointmentUncheckedUpdateInput, db: Db = prisma) {
    return db.appointment.update({ where: { id }, data });
  },

  /**
   * Cursor-paginated search across all appointments (ops console). The cursor
   * is the last item's id; a full page returns the next cursor, otherwise null.
   */
  async search(
    filters: AppointmentFilters,
    opts: { cursor?: string; limit: number },
    db: Db = prisma,
  ): Promise<PageOf<Appointment>> {
    const where: Prisma.AppointmentWhereInput = {
      providerId: filters.providerId,
      customerId: filters.customerId,
      status: filters.status,
      startsAt:
        filters.from || filters.to ? { gte: filters.from, lt: filters.to } : undefined,
    };
    const rows = await db.appointment.findMany({
      where,
      orderBy: { id: 'asc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, opts.limit);
    const nextCursor = rows.length > opts.limit ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  },
};
