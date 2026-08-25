/**
 * Paraphrased true-bug for code-quality/deterministic/for-in-without-filter.
 *
 * `parsed` is the result of `JSON.parse(...)` with no type annotation — its
 * runtime shape is whatever the caller wrote into the input string,
 * including arbitrary inherited keys. Iterating with `for…in` and writing
 * the values without a `hasOwnProperty` check leaks inherited properties.
 */

export function dumpKeys(input: string): string[] {
  const parsed = JSON.parse(input);
  const keys: string[] = [];
  // VIOLATION: code-quality/deterministic/for-in-without-filter
  for (const key in parsed) {
    keys.push(key);
  }
  return keys;
}
