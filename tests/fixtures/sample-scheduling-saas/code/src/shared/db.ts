import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * The shared Prisma client. Postgres is the single system of record for both
 * apps (ADR 0002); the booking app and the ops console open this same client.
 */
export const prisma = new PrismaClient();

/**
 * Either the root client or a transaction client — repo methods accept this so
 * a service can run reads/writes inside a `prisma.$transaction` alongside the
 * outbox write (ADR 0002).
 */
export type Db = PrismaClient | Prisma.TransactionClient;
