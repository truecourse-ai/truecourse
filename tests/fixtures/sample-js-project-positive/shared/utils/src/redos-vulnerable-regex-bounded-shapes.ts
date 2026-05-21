// Paraphrased FP shape for bugs/deterministic/redos-vulnerable-regex.

// Optional capture group: `(P)?` repeats at most once. Even when the inner
// quantifier matches characters from the outer group's class, no catastrophic
// backtracking is possible because the outer multiplier is bounded to {0,1}.
// (The slug-style anchored-repetition FP from the upstream issue is also
// fixed by this visitor change, but it triggers a separate `regex-empty-repetition`
// rule that uses the same over-broad detection — that one is out of scope
// for this fixture.)
export function isCssDimensionLike(input: string): boolean {
  return /^(?:0|\d+(?:\.\d+)?(?:em|rem|px|%))$/iu.test(input);
}
