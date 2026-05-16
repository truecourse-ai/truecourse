function expectsNumber_dc63fe3f(x: number): number { return x * 2; }
export function caller_dc63fe3f(): number {
  return expectsNumber_dc63fe3f("not a number" as unknown as number);
}
