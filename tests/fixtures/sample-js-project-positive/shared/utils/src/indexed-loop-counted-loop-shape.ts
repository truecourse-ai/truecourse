// Paraphrased FP shape for code-quality/deterministic/indexed-loop-over-for-of.
//
// Counted loop: iterate a fixed numeric upper bound without using the loop
// variable as an array index. The upper bound is a plain count (no array
// is involved at all), so `for...of` is inapplicable — there's nothing to
// iterate over.
export function tryWindowedCounter(
  initialNow: number,
  window: number,
  period: number,
): number | null {
  let now = initialNow;
  for (let i = 0; i < window; i++) {
    const counter = Math.floor(now / period);
    if (counter < 0) return null;
    now -= period;
  }
  return now;
}
