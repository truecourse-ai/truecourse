/**
 * An exported helper that is never imported anywhere — a genuine
 * unused export.
 */

// VIOLATION: architecture/deterministic/unused-export
// VIOLATION: architecture/deterministic/dead-method
export function computeOrphanedAggregate(values: number[]): number {
  return values.reduce((acc, n) => acc + n, 0);
}
