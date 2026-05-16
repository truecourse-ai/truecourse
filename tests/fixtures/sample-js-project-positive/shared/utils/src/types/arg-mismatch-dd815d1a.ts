function expectsNumber_dd815d1a(x: number): number { return x * 2; }
export function caller_dd815d1a(): number {
  return expectsNumber_dd815d1a("not a number" as unknown as number);
}
