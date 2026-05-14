function expectsNumber_b147ae22(x: number): number { return x * 2; }
export function caller_b147ae22(): number {
  return expectsNumber_b147ae22("not a number" as unknown as number);
}
