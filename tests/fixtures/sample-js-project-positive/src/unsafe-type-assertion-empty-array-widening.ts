/**
 * Positive fixture for bugs/deterministic/unsafe-type-assertion.
 *
 * `[] as T[]` is a safe widening assertion used to give an empty-array
 * initializer the element type the caller intended. Without it, TypeScript
 * infers `never[]` (most commonly for reduce seeds and object-literal
 * accumulators), which then rejects every later push/concat. The rule should
 * skip this exact shape — `[] as Foo[]` with no items in the array literal.
 */

type Outcome = { ok: boolean; errors: string[] };

export function collectOutcome(events: ReadonlyArray<{ message?: string }>): Outcome {
  const out: Outcome = {
    ok: true,
    errors: [] as string[],
  };

  for (const ev of events) {
    if (ev.message !== undefined) {
      out.ok = false;
      out.errors.push(ev.message);
    }
  }

  return out;
}

export function partitionByLabel<T extends { label: string }>(
  items: readonly T[],
  label: string,
): { matched: T[]; rest: T[] } {
  return items.reduce(
    (acc, item) => {
      if (item.label === label) acc.matched.push(item);
      else acc.rest.push(item);
      return acc;
    },
    { matched: [] as T[], rest: [] as T[] },
  );
}
