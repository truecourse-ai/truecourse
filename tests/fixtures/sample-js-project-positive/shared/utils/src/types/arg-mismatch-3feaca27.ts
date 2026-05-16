function expectsNumber_3feaca27(x: number): number { return x * 2; }
export function caller_3feaca27(): number {
  return expectsNumber_3feaca27("not a number" as unknown as number);
}
