/**
 * Paraphrased true-bug for bugs/deterministic/function-return-type-varies.
 *
 * `classify` returns a string on one path, a number on another, and an
 * unrelated object on a third — there is no shared discriminator key and
 * the return types are genuinely heterogeneous. Callers cannot rely on a
 * stable shape without runtime type checks.
 */

// VIOLATION: bugs/deterministic/function-return-type-varies
export function classify(input: number) {
  if (Number.isNaN(input)) {
    return 'not-a-number';
  }
  if (input < 0) {
    return -1;
  }
  return { value: input, doubled: input * 2 };
}
