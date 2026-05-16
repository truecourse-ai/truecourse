function expectsNumber_808d0658(x: number): number { return x * 2; }
export function caller_808d0658(): number {
  return expectsNumber_808d0658("not a number" as unknown as number);
}
