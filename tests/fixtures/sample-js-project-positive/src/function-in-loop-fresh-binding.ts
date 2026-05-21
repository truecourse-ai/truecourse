/**
 * Positive fixture for code-quality/deterministic/function-in-loop.
 *
 * `for (const x of arr)` and `for (let x of arr)` create a fresh
 * per-iteration binding, so a closure defined inside the loop body does NOT
 * carry the capture-by-reference hazard. The visitor should not flag
 * function-in-loop for these `for…of` / `for…in` forms with `const`/`let`.
 */

interface ItemRecord {
  readonly id: string;
  readonly title: string;
}

export function buildIdFormatters(items: readonly ItemRecord[]): string[] {
  const results: string[] = [];
  for (const item of items) {
    const formatId = (): string => `id:${item.id}`;
    results.push(formatId());
  }
  return results;
}

export function buildTitleFormatters(items: readonly ItemRecord[]): string[] {
  const results: string[] = [];
  for (let item of items) {
    const formatTitle = (): string => `t:${item.title}`;
    results.push(formatTitle());
  }
  return results;
}
