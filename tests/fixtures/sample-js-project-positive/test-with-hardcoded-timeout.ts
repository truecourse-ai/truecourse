// A route-style helper whose filename merely contains the substring "test"
// (like a `tests.*` route module) — it is NOT a unit/integration test.
// Scheduling a delay with setTimeout is perfectly normal in production code
// and must not be flagged as a "hardcoded timeout in a test".

export function delayFor(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
