function expectsNumber_a22d6ad1(x: number): number { return x * 2; }
export function caller_a22d6ad1(): number {
  return expectsNumber_a22d6ad1("not a number" as unknown as number);
}
