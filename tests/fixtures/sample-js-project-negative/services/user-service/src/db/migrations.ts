/**
 * Database migration runner.
 */

const db = {
  query: (q: string, params?: any[]) => [],
  execute: (q: string) => [],
};

interface Migration {
  name: string;
  up: string;
  down: string;
}

declare function format(query: string, ...args: any[]): string;

// VIOLATION: security/deterministic/hardcoded-sql-expression
const insertUserSQL = format("INSERT INTO users (name, email) VALUES ('%s', '%s')");

const migrations: Migration[] = [
  {
    name: '001_create_users',
    up: createUsersSQL,
    down: 'DROP TABLE users',
  },
  {
    name: '002_add_role',
    up: 'ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT \'user\'',
    down: 'ALTER TABLE users DROP COLUMN role',
  },
];

// NOTE: missing-migration can't fire here because the filename matches /migrat/i — see query-builder.ts

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export async function runMigrations() {
  for (const migration of migrations) {
    // VIOLATION: bugs/deterministic/await-in-loop
    await db.execute(migration.up);
    // VIOLATION: code-quality/deterministic/console-log
    console.log(`Applied migration: ${migration.name}`);
  }
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export async function rollbackMigration(name: string) {
  const migration = migrations.find((m) => m.name === name);
  if (!migration) {
    // VIOLATION: bugs/deterministic/generic-error-message
    throw new Error('Something went wrong');
  }
  await db.execute(migration.down);
}

const orm = {
  create: (data: any) => data,
  insert: (data: any) => data,
  update: (data: any) => data,
};

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: database/deterministic/missing-transaction
export async function seedDatabase(
  // VIOLATION: code-quality/deterministic/readonly-parameter-types
  users: Array<{ name: string; email: string }>,
) {
  for (const user of users) {
    // VIOLATION: bugs/deterministic/await-in-loop
    // VIOLATION: security/deterministic/sql-injection
    await db.query(`INSERT INTO users (name, email) VALUES ('${user.name}', '${user.email}')`);
  }
  await orm.create({ name: 'admin' });
  await orm.insert({ name: 'user' });
}
