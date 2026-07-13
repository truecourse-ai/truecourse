import { type Prisma } from '@prisma/client';
import { prisma, type Db } from '../db.js';

/** Refund persistence — owned by the ops console. */
export const refundsRepo = {
  create(data: Prisma.RefundUncheckedCreateInput, db: Db = prisma) {
    return db.refund.create({ data });
  },
  listForAppointment(appointmentId: string, db: Db = prisma) {
    return db.refund.findMany({ where: { appointmentId }, orderBy: { createdAt: 'desc' } });
  },
};
