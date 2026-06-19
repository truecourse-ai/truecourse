// A genuine duplicate-string bug: the same query fragment is repeated across
// three builders in one file. Extracting it to a named constant deduplicates
// the query and keeps it consistent if the schema or filter changes.

declare function runQuery(sql: string): Promise<unknown>;

// VIOLATION: code-quality/deterministic/duplicate-string
export function activeReport(): Promise<unknown> {
  return runQuery("SELECT id, label FROM accounts WHERE archived = false");
}

export function activeExport(): Promise<unknown> {
  return runQuery("SELECT id, label FROM accounts WHERE archived = false");
}

export function activeCount(): Promise<unknown> {
  return runQuery("SELECT id, label FROM accounts WHERE archived = false");
}
