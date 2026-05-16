function expectsNumber_fdfb1e03(x: number): number { return x * 2; }
export function caller_fdfb1e03(): number {
  return expectsNumber_fdfb1e03("not a number" as unknown as number);
}
