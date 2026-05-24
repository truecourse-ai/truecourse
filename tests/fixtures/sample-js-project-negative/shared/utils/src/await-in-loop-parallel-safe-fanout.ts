/**
 * Paraphrased true-bug for bugs/deterministic/await-in-loop.
 *
 * The loop awaits an independent network fetch per id and collects the
 * sizes into an array. Iterations have no shared state, no early exit, no
 * iterator-protocol dependency, and no transaction context — the canonical
 * "use Promise.all" case.
 */

async function fetchUserSummary(id: string): Promise<{ id: string; bytes: number }> {
  return { id, bytes: id.length * 2 };
}

export async function totalSummaryBytes(ids: readonly string[]): Promise<number> {
  const sizes: number[] = [];
  for (const id of ids) {
    // VIOLATION: bugs/deterministic/await-in-loop
    const summary = await fetchUserSummary(id);
    sizes.push(summary.bytes);
  }
  return sizes.reduce((a, b) => a + b, 0);
}
