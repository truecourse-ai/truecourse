function expectsNumber_771cc8e6(x: number): number { return x * 2; }
export function caller_771cc8e6(): number {
  return expectsNumber_771cc8e6("not a number" as unknown as number);
}
