// VIOLATION: architecture/deterministic/god-module
/**
 * Database query utilities — covers connection, query, and ORM patterns.
 */
// Import an ORM so orm-lazy-load-in-loop knows this file uses ORM patterns.
// (The Lucid `BaseModel` import is unused at runtime, just signals ORM presence.)
import { BaseModel as _BaseModel } from '@adonisjs/lucid/orm';

const pool = {
  connect: () => ({ query: (q: string) => [], release: () => {} }),
  query: (q: string, params?: any[]) => [],
};
const db = {
  query: (q: string, params?: any[]) => [],
  execute: (q: string) => [],
};
const User = {
  create: (data: any) => data,
  findOne: (where: any) => null as any,
  insert: (data: any) => data,
  update: (data: any) => data,
  delete: (where: any) => {},
};

// VIOLATION: database/deterministic/connection-not-released
export async function queryWithoutRelease() {
  const client = await pool.connect();
  const result = client.query('SELECT 1');
  return result;
}

// VIOLATION: database/deterministic/missing-migration
export async function alterTable() {
  await db.query('ALTER TABLE users ADD COLUMN age INTEGER');
}

// NOTE: missing-transaction now skipped for single-table operations
export async function multiWrite(name: string, email: string) {
  await User.create({ name });
  await User.insert({ email });
}

// VIOLATION: database/deterministic/missing-transaction
const Account = { update: (data: any) => data };
const Transfer = { insert: (data: any) => data };
export async function transferFunds(fromId: string, toId: string, amount: number) {
  await Account.update({ id: fromId, balance: -amount });
  await Transfer.insert({ from: fromId, to: toId, amount });
}

// `phone` is NOT @unique in schema.prisma — race-prone uniqueness check.
const prisma = { user: { findFirst: (_o: any) => null as any, create: (_d: any) => null as any }, profile: { findFirst: (_o: any) => null as any, create: (_d: any) => null as any } };
// VIOLATION: database/deterministic/missing-unique-constraint
export async function checkAndCreateByPhone(phone: string) {
  if (!(await prisma.user.findFirst({ where: { phone } }))) {
    await prisma.user.create({ data: { phone } });
  }
}

// `displayName` is NOT @unique in schema.prisma — race-prone uniqueness check.
// VIOLATION: database/deterministic/missing-unique-constraint
export async function checkAndCreateProfile(displayName: string) {
  if (!(await prisma.profile.findFirst({ where: { displayName } }))) {
    await prisma.profile.create({ data: { displayName } });
  }
}

// VIOLATION: database/deterministic/orm-lazy-load-in-loop
export async function loadRelations(users: any[]) {
  for (const user of users) {
    const posts = await user.related('posts');
    console.log(posts);
  }
}

// VIOLATION: database/deterministic/select-star
export async function selectAll() {
  return db.query('SELECT * FROM users');
}

// VIOLATION: database/deterministic/unsafe-delete-without-where
export async function deleteAll() {
  await db.execute('DELETE FROM temp_logs');
}

// VIOLATION: database/deterministic/unvalidated-external-data
export async function createFromRequest(req: any) {
  await User.create(req.body);
}

// VIOLATION: database/deterministic/unvalidated-external-data
// Destructured alias of req.body — pre-fix this was MISSED because the rule
// only matched the literal substring "req.body". Now caught via scope analysis.
export async function createFromDestructuredRequest(req: any) {
  const { body } = req;
  await User.create(body);
}
