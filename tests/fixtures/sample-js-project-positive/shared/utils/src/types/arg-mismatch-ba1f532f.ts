function expectsNumber_ba1f532f(x: number): number { return x * 2; }
export function caller_ba1f532f(): number {
  return expectsNumber_ba1f532f("not a number" as unknown as number);
}
