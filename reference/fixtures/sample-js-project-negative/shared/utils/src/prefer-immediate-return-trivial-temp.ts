// Paraphrased true-bug for code-quality/deterministic/prefer-immediate-return.
//
// A one-line arithmetic expression assigned to a temp and immediately
// returned — the binding adds no clarity over the inline expression.

export function totalScore(values: readonly number[]): number {
  // VIOLATION: code-quality/deterministic/prefer-immediate-return
  const total = values.reduce((acc, n) => acc + n, 0);
  return total;
}
