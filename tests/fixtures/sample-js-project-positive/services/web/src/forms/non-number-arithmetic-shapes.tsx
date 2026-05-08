/**
 * non-number-arithmetic shape that should NOT fire:
 *
 * Sort comparator using `?? 0` to coerce a possibly-undefined
 * indexed value to a numeric fallback. The nullish-coalesce
 * guarantees a number at runtime even if the type query
 * reports `number | undefined`.
 */

declare const idOrder: Map<string, number>;

export function sortByOrder(a: { id: string }, b: { id: string }): number {
  return (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0);
}
