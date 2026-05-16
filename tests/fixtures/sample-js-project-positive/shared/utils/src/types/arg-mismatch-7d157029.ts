function expectsNumber_7d157029(x: number): number { return x * 2; }
export function caller_7d157029(): number {
  return expectsNumber_7d157029("not a number" as unknown as number);
}
