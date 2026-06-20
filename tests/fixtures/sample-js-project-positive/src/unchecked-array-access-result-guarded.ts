// `process.env[name]` is `string | undefined`, and the very next statement
// guards the *bound result* with `if (!value)` before it is used. The access
// is fully handled, so the rule must not flag it merely because the index is a
// variable — the guard names the result, not the index.

export function boolFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  return value === "true";
}
