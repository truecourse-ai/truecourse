// Positive: reliability/deterministic/promise-all-no-error-handling
//
// `await Promise.all(...)` inside an async function is not fire-and-forget —
// any rejection becomes a thrown exception that propagates to the caller
// (route handler, transaction wrapper, job runner, …) where the framework's
// error boundary takes over. The rule should only flag Promise.all calls
// whose rejection truly vanishes.

export async function loadDashboard(ids: readonly string[]): Promise<{ entries: number[]; total: number }> {
  const [entries, total] = await Promise.all([
    fetchEntries(ids),
    countEntries(ids),
  ]);
  return { entries, total };
}

export async function fetchAllRecords(keys: readonly string[]): Promise<readonly number[]> {
  const records = await Promise.all(keys.map((key) => fetchRecord(key)));
  return records.slice();
}

function fetchEntries(ids: readonly string[]): Promise<number[]> {
  return Promise.resolve(ids.map((_, i) => i));
}

function countEntries(ids: readonly string[]): Promise<number> {
  return Promise.resolve(ids.length);
}

function fetchRecord(key: string): Promise<number> {
  return Promise.resolve(key.length);
}
