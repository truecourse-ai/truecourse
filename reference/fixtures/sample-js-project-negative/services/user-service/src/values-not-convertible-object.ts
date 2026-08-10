/**
 * Relational comparison against a plain object — coercion produces NaN,
 * so the comparison is always false.
 */

// VIOLATION: bugs/deterministic/values-not-convertible-to-number
export function isPriorityHigher(left: object, right: number): boolean {
  return left > right;
}
