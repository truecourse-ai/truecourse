function expectsNumber_bfc35c6f(x: number): number { return x * 2; }
export function caller_bfc35c6f(): number {
  return expectsNumber_bfc35c6f("not a number" as unknown as number);
}
