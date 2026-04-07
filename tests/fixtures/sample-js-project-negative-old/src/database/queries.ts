/**
 * Database violations covering connection management, queries, and ORM patterns.
 */

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
export async function connectionNotReleased() {
  const client = await pool.connect();
  const result = client.query('SELECT 1');
  return result;
}

// VIOLATION: database/deterministic/missing-migration
export async function missingMigration() {
  await db.query('ALTER TABLE users ADD COLUMN age INTEGER');
}

// VIOLATION: database/deterministic/missing-transaction
export async function missingTransaction(name: string, email: string) {
  await User.create({ name });
  await User.insert({ email });
}

// VIOLATION: database/deterministic/missing-unique-constraint
export async function missingUniqueConstraint(email: string) {
  if (!(await User.findOne({ email }))) {
    await User.create({ email });
  }
}

// VIOLATION: database/deterministic/orm-lazy-load-in-loop
export async function ormLazyLoadInLoop(users: any[]) {
  for (const user of users) {
    const posts = await user.related('posts');
    console.log(posts);
  }
}

// VIOLATION: database/deterministic/select-star
export async function selectStar() {
  return db.query('SELECT * FROM users');
}

// VIOLATION: database/deterministic/unsafe-delete-without-where
export async function unsafeDeleteWithoutWhere() {
  await db.execute('DELETE FROM temp_logs');
}

// VIOLATION: database/deterministic/unvalidated-external-data
export async function unvalidatedExternalData(req: any) {
  await User.create(req.body);
}
