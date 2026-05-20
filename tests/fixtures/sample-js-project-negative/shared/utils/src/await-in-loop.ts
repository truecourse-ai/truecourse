/**
 * Paraphrased true-bug for bugs/deterministic/await-in-loop.
 *
 * A for-of loop awaiting an independent network call per item — classic
 * "use Promise.all" case. Iterations have no dependency on each other.
 */

async function fetchRecord(id: string): Promise<{ id: string; size: number }> {
  return { id, size: id.length };
}

export async function fetchAllRecords(ids: readonly string[]): Promise<number> {
  let total = 0;
  for (const id of ids) {
    // VIOLATION: bugs/deterministic/await-in-loop
    const record = await fetchRecord(id);
    total += record.size;
  }
  return total;
}
