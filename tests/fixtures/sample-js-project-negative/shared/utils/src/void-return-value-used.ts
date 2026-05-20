/**
 * Paraphrased true-bug for bugs/deterministic/void-return-value-used.
 *
 * `Array.prototype.forEach` always returns undefined — assigning its
 * result is a real bug; the caller probably meant `.map`.
 */

export function squareAll(values: number[]): void {
  // @ts-expect-error — intentional bug: assigning the void return of forEach.
  // VIOLATION: bugs/deterministic/void-return-value-used
  const squared: number[] = values.forEach((n) => n * n);
  void squared;
}
