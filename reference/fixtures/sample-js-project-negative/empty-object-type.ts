// Annotating a value as `{}` is almost always a mistake: the `{}` type matches
// everything except `null`/`undefined`, so the compiler will not catch passing
// a number or string where a real object was intended. This is the footgun the
// rule is meant to flag.

// VIOLATION: bugs/deterministic/empty-object-type
export function mergeSettings(overrides: {}): Record<string, unknown> {
  return { ...overrides };
}
