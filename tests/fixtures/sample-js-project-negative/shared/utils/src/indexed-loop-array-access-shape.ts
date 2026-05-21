// Negative case: classic `for (let i = 0; i < arr.length; i++) { arr[i] }`
// where the index is used solely to access the array. The rule must still
// catch this — `for...of` is the idiomatic replacement.

// VIOLATION: code-quality/deterministic/indexed-loop-over-for-of
export function sumBytes(buf: number[]): number {
  let total = 0;
  for (let i = 0; i < buf.length; i++) {
    total += buf[i];
  }
  return total;
}
