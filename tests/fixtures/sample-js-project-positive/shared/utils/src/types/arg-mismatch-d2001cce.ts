function expectsNumber_d2001cce(x: number): number { return x * 2; }
export function caller_d2001cce(): number {
  return expectsNumber_d2001cce("not a number" as unknown as number);
}
