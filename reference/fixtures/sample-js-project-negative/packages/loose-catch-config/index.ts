// This package's tsconfig sets `useUnknownInCatchVariables: false`, so the
// catch parameter below is implicitly `any` — that's the bug the rule is
// meant to catch, because callers can dereference arbitrary properties on an
// untyped error without any compiler help.

export function parseJsonOrNull(input: string): unknown {
  try {
    return JSON.parse(input);
  // VIOLATION: code-quality/deterministic/unknown-catch-variable
  } catch (err) {
    return null;
  }
}
