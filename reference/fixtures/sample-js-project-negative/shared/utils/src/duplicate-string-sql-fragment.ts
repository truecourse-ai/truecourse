/**
 * A genuine duplicate-string bug: the same SQL fragment appears in
 * three query builders. Extracting it to a constant deduplicates the
 * SQL and keeps it consistent if the schema or filter changes.
 */

declare function db(): { query(sql: string): Promise<unknown> };

// VIOLATION: code-quality/deterministic/duplicate-string
export function listActiveUsers(): Promise<unknown> {
  return db().query('SELECT id, email FROM users WHERE active = true');
}

export function countActiveUsers(): Promise<unknown> {
  return db().query('SELECT id, email FROM users WHERE active = true');
}

export function exportActiveUsers(): Promise<unknown> {
  return db().query('SELECT id, email FROM users WHERE active = true');
}
