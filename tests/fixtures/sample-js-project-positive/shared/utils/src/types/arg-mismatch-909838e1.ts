function expectsNumber_909838e1(x: number): number { return x * 2; }
export function caller_909838e1(): number {
  return expectsNumber_909838e1("not a number" as unknown as number);
}
