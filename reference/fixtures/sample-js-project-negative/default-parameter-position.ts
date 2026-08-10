// A required, named parameter that appears after a parameter with a default
// value. Callers can never benefit from the default without also passing the
// trailing argument, so the default is effectively dead — this is the real bug
// the rule is meant to catch.

// VIOLATION: code-quality/deterministic/default-parameter-position
export function applyDiscount(rate = 0.1, amount: number): number {
  return amount - amount * rate;
}
