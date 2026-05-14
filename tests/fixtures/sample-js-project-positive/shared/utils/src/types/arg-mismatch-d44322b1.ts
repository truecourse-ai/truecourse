function expectsNumber_d44322b1(x: number): number { return x * 2; }
export function caller_d44322b1(): number {
  return expectsNumber_d44322b1("not a number" as unknown as number);
}
