import { PrismaClient } from '@prisma/client';
import pg from 'pg';
export const client = env => new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
export function ownedName(env) {
  const name = env.GUARD_PREPARATION_NAMESPACE;
  if (!/^guard_[a-f0-9]{32}$/.test(name)) throw new Error('Invalid owned database');
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    if (new URL(env[key]).pathname !== '/' + name) throw new Error('Private database binding mismatch');
  }
  return name;
}
export async function admin(env) {
  const base = JSON.parse(env.GUARD_PREPARATION_POSTGRES_BASE_URLS).DIRECT_URL;
  const connection = new pg.Client({ connectionString: base });
  await connection.connect();
  return connection;
}
