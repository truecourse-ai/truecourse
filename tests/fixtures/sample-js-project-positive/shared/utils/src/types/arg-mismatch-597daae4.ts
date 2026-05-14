function expectsNumber_597daae4(x: number): number { return x * 2; }
export function caller_597daae4(): number {
  return expectsNumber_597daae4("not a number" as unknown as number);
}
