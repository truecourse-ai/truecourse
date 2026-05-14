function expectsNumber_7f70a12f(x: number): number { return x * 2; }
export function caller_7f70a12f(): number {
  return expectsNumber_7f70a12f("not a number" as unknown as number);
}
