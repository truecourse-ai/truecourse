/**
 * Positive fixture for code-quality/deterministic/for-in-without-filter.
 *
 * `input` is a function parameter with an explicit TypeScript type
 * annotation (`Partial<Foo>`). The author has constrained the shape via the
 * type system, so the `for…in` iterates a known-keys object. Demanding a
 * `hasOwnProperty` / `Object.hasOwn` check here is a false positive.
 */

type Foo = { a: string; b: number; c: boolean };

export function countTruthy(input: Partial<Foo>): number {
  let n = 0;
  for (const key in input) {
    if (input[key as keyof Foo] != null) {
      n += 1;
    }
  }
  return n;
}
