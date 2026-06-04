export function firstSquareUnder(limit: number): number {
  // VIOLATION: bugs/deterministic/unreachable-loop
  for (let i = 1; i < limit; i++) {
    const square = i * i;
    return square;
  }
  return 0;
}
