// Genuinely returns a string from one path and a number from another, with
// no return annotation — callers can't rely on a single return type. This
// is the real inconsistency the rule is meant to catch.
// VIOLATION: bugs/deterministic/function-return-type-varies
export function parseAmount(raw: string) {
  if (raw.trim() === "") {
    return "empty";
  }
  return Number(raw);
}
