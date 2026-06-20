// Negative fixture: the access result is bound to a local, but nothing ever
// guards it — no `if`, no length check, no fallback. A caller-supplied offset
// is used directly, so the element may be undefined at runtime.

export function fieldAt(parts: string[], offset: number): string {
  // VIOLATION: reliability/deterministic/unchecked-array-access
  const field = parts[offset];
  return field.trim();
}
