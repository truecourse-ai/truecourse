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
