/**
 * Comparing a boolean to a number coerces `true` to 1 and `false` to 0 —
 * almost certainly not what the caller meant. Probably a sign of a missing
 * `.length`, a counter access, or a forgotten conversion.
 */

export function isLeading(flag: boolean, threshold: number): boolean {
  // VIOLATION: bugs/deterministic/values-not-convertible-to-number
  return flag > threshold;
}
