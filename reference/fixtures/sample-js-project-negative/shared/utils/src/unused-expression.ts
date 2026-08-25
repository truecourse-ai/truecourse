/**
 * Paraphrased true-bug for code-quality/deterministic/unused-expression.
 *
 * A plain identifier reference as an expression statement is a no-op —
 * almost always a forgotten assignment or call.
 */

export function consumeCounter(counter: number): number {
  // VIOLATION: code-quality/deterministic/unused-expression
  counter;
  return counter + 1;
}
