// Paraphrased true-bug for performance/deterministic/spread-in-reduce.
//
// Spreading the accumulator into a brand-new object on every iteration
// re-copies the entire result-so-far, turning a linear fold into O(n^2)
// work. The accumulator should be mutated in place instead.

export function countWords(words: string[]): Record<string, number> {
  // VIOLATION: performance/deterministic/spread-in-reduce
  return words.reduce<Record<string, number>>(
    (acc, word) => ({ ...acc, [word]: (acc[word] ?? 0) + 1 }),
    {},
  );
}
