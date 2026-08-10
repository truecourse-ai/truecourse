/**
 * A genuine prefer-const bug: a simple `let` binding initialized
 * once, never reassigned (no augmented assignment, no destructured
 * assignment, not a loop header). Changing `let` to `const` is safe.
 */

declare function compute(): number;

export function readOnce(): number {
  // VIOLATION: code-quality/deterministic/prefer-const
  let value = compute();
  return value * 2;
}
