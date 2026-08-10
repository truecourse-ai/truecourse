/**
 * Paraphrased true-bug for architecture/deterministic/declarations-in-global-scope.
 *
 * Production module-level `let` — a request-handling helper file (not a
 * test file, not a `.test.ts`). The mutable global is the canonical
 * "where did this value come from?" cross-request bug.
 */

// VIOLATION: architecture/deterministic/declarations-in-global-scope
let activeConnections = 0;

export function noteConnect(): void {
  activeConnections += 1;
}

export function noteDisconnect(): void {
  activeConnections -= 1;
}
