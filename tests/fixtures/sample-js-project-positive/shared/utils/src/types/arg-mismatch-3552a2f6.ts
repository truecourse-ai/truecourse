function expectsNumber_3552a2f6(x: number): number { return x * 2; }
export function caller_3552a2f6(): number {
  return expectsNumber_3552a2f6("not a number" as unknown as number);
}
