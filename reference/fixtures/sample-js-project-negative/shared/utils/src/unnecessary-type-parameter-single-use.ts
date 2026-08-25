// True bug pattern: a generic type parameter appears exactly once in
// the function signature, never in the body, and the return type
// doesn't carry it. The parameter relates nothing — `unknown` or the
// constraint type works just as well.

// VIOLATION: code-quality/deterministic/unnecessary-type-parameter
export function logFirstField<T>(record: { id: T }): void {
  console.log('first field', String(record.id));
}
