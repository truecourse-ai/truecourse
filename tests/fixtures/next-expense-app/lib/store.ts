import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Expense, ExpenseList } from './expenses';
import { parseExpense, parseQuery } from './validation';

// Local SQLite is shared across requests, never request-specific state.
let connection: DatabaseSync | undefined;
export function database(): DatabaseSync {
  if (connection) return connection;
  const filename = path.resolve(process.env.SQLITE_PATH || './data/expenses.sqlite');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 120),
      amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 999999999),
      category TEXT NOT NULL CHECK(category IN ('Food & drink','Transport','Shopping','Bills','Health','Other')),
      date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS expenses_date ON expenses(date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS expenses_category ON expenses(category);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  connection = db;
  return db;
}
const columns = 'id, description, amount_cents AS amountCents, category, date, notes, created_at AS createdAt, updated_at AS updatedAt';
export function getExpense(id: number): Expense | null {
  return database().prepare(`SELECT ${columns} FROM expenses WHERE id = ?`).get(id) as Expense | undefined ?? null;
}
export function listExpenses(params: URLSearchParams): ExpenseList {
  const { q, category, from, to, page: requestedPage } = parseQuery(params);
  const clauses: string[] = [];
  const values: string[] = [];
  if (q) { clauses.push("(description LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')"); const needle = `%${q.replace(/[\\%_]/g, '\\$&')}%`; values.push(needle, needle); }
  if (category) { clauses.push('category = ?'); values.push(category); }
  if (from) { clauses.push('date >= ?'); values.push(from); }
  if (to) { clauses.push('date <= ?'); values.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const db = database();
  // One snapshot keeps page rows and both totals consistent across processes.
  db.exec('BEGIN');
  try {
    const stats = db.prepare(`SELECT count(*) AS totalCount, coalesce(sum(amount_cents), 0) AS filteredTotalCents FROM expenses ${where}`).get(...values) as { totalCount: number; filteredTotalCents: number };
    const { totalSpentCents } = db.prepare('SELECT coalesce(sum(amount_cents), 0) AS totalSpentCents FROM expenses').get() as { totalSpentCents: number };
    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(stats.totalCount / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const expenses = db.prepare(`SELECT ${columns} FROM expenses ${where} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Expense[];
    db.exec('COMMIT');
    return { expenses, page, pageSize, totalPages, ...stats, totalSpentCents };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function createExpense(value: unknown): Expense {
  const input = parseExpense(value);
  const now = new Date().toISOString();
  const result = database().prepare('INSERT INTO expenses (description, amount_cents, category, date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(input.description, input.amountCents, input.category, input.date, input.notes, now, now);
  return getExpense(Number(result.lastInsertRowid))!;
}
export function updateExpense(id: number, value: unknown): Expense | null {
  const input = parseExpense(value);
  const result = database().prepare('UPDATE expenses SET description = ?, amount_cents = ?, category = ?, date = ?, notes = ?, updated_at = ? WHERE id = ?').run(input.description, input.amountCents, input.category, input.date, input.notes, new Date().toISOString(), id);
  return result.changes ? getExpense(id) : null;
}
export function deleteExpense(id: number): boolean {
  return database().prepare('DELETE FROM expenses WHERE id = ?').run(id).changes > 0;
}
export function closeDatabase() { connection?.close(); connection = undefined; }
