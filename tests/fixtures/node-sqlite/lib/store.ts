import { DatabaseSync } from 'node:sqlite';

export function database() {
  const db = new DatabaseSync(process.env.SQLITE_PATH || './data/expenses.sqlite');
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 120),
      amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 999999999),
      category TEXT NOT NULL CHECK(category IN ('Food & drink','Transport','Other')),
      date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS expenses_date ON expenses(date DESC, id DESC);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  return db;
}
