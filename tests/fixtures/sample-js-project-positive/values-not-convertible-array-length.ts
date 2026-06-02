// When the analyzer's TS pass can't fully resolve an upstream type (Prisma
// payload generics, helper-function return types behind missing
// node_modules, exhaustively-narrowed unions, etc.), it sometimes serialises
// the operand's type as `never`. The rule used to flag this as a
// non-numeric comparison, but a `never` here is a "type-information
// missing" artifact, not a real coercion bug — those code paths are
// either unreachable or use numbers fine at runtime.

export function unreachableCompare(x: never, threshold: number): boolean {
  return x > threshold;
}

export function unreachableCompareReverse(threshold: number, x: never): boolean {
  return threshold < x;
}
