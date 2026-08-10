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

// True bug: narrows with `instanceof` directly in its own body but returns a
// bare `boolean` — callers get no narrowing. It should return `err is Error`.
// VIOLATION: code-quality/deterministic/type-guard-preference
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError';
}
