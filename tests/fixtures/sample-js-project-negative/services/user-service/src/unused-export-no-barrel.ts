// A standalone exported helper that nothing imports and no barrel
// re-exports. The export is genuinely dead and must be flagged.

// VIOLATION: architecture/deterministic/unused-export
// VIOLATION: architecture/deterministic/dead-method
export function summarizeAuditLogEntries(entries: { weight: number }[]): number {
  return entries.reduce((acc, e) => acc + e.weight, 0);
}
