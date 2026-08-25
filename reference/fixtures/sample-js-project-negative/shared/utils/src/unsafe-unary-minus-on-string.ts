/**
 * Unary minus on a string operand silently produces NaN at runtime — the
 * developer probably meant to parse the string to a number first.
 */

export function negatedConfigValue(raw: string): number {
  // VIOLATION: bugs/deterministic/unsafe-unary-minus
  return -raw;
}
