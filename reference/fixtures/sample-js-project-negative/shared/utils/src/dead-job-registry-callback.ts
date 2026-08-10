// VIOLATION: architecture/deterministic/dead-module
// Regression case: a job-definition-style export that is never imported.
// The dead-module rule SHOULD fire here.
export function processAbandonedQueue(items: string[]): number {
  return items.length;
}
