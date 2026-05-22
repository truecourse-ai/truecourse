/**
 * Negative fixture: a raw user-provided index used without a guard. The
 * caller hands `position` in unchecked, and there's no length/sentinel/
 * type-cast assertion that the slot exists.
 */

export function nameAt(roster: string[], position: number): string {
  // VIOLATION: reliability/deterministic/unchecked-array-access
  const candidate = roster[position];
  return candidate.toUpperCase();
}
