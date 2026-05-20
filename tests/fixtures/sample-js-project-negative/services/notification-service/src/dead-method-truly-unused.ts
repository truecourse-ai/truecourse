/**
 * An exported helper that is never imported anywhere and never called
 * within its own file — a genuine dead method.
 */

// VIOLATION: architecture/deterministic/dead-method
// VIOLATION: architecture/deterministic/unused-export
export function pruneStaleCacheEntries(): void {
  const now = Date.now();
  void now;
}
