/**
 * Paraphrased true-bug for code-quality/deterministic/unnecessary-type-assertion.
 *
 * Asserting `as string` on a value already typed as `string` is a no-op
 * that adds noise. The rule should fire and the assertion should be
 * removed.
 */

export function greetLength(name: string): number {
  // VIOLATION: code-quality/deterministic/unnecessary-type-assertion
  return (name as string).length;
}
