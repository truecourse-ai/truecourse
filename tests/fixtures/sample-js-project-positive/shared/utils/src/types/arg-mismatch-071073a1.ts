function expectsNumber_071073a1(x: number): number { return x * 2; }
export function caller_071073a1(): number {
  return expectsNumber_071073a1("not a number" as unknown as number);
}
