/**
 * Two functions that narrow with `typeof` and return the resulting
 * boolean. Both should declare their return type as a type predicate.
 */

// VIOLATION: code-quality/deterministic/type-guard-preference
export function isStringValue(input: unknown): boolean {
  return typeof input === 'string';
}

// VIOLATION: code-quality/deterministic/type-guard-preference
export function isNumberValue(input: unknown): boolean {
  return typeof input === 'number';
}
