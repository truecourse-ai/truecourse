// Numeric arrays sorted without a comparator are the actual bug the rule
// targets — lexicographic order produces [1, 10, 2, 20, 3] instead of the
// expected numeric order. .toSorted() has the same pitfall as .sort().

// VIOLATION: bugs/deterministic/array-sort-without-compare
export function toSortedNumeric(items: readonly number[]): number[] {
  return items.toSorted();
}
