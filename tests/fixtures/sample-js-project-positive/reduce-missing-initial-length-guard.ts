// The array is guarded against emptiness before the reduce, so calling reduce
// without an initial value can never throw on an empty array — the missing
// initial is intentional and must NOT trip
// bugs/deterministic/reduce-missing-initial.
export function total(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, curr) => acc + curr);
}
