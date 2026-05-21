/**
 * Negative fixture for reliability/deterministic/unchecked-array-access.
 *
 * The rule should still fire when an array is indexed by a variable that is
 * not bounded against `.length` and has no fallback / Record typing in scope.
 */

export function firstStringOver(items: string[], lookup: number[]): string {
  // VIOLATION: reliability/deterministic/unchecked-array-access
  const candidate = items[lookup[0]];
  return candidate.toUpperCase();
}
