import knex from 'knex';
import { PrismaClient } from '@prisma/client';

/**
 * Shared data-layer clients. Postgres is the system of record (see
 * docs/adr/ADR-001-data-store.md): Knex drives the orders tables and the
 * raw loyalty-tier lookups, Prisma drives the customers store.
 */
export const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient();

// FP-GUARD: enum/no-code-counterpart — must NOT drift
// The FK constraint action type uses space-separated values matching the
// database driver's convention (e.g. 'SET NULL'); the spec contract records
// them with underscore separators (SET_NULL). The comparator must normalise
// value separators before similarity matching so both formats are equivalent.
export type ForeignKeyAction = 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION' | 'SET DEFAULT';
