function expectsNumber_35d2a464(x: number): number { return x * 2; }
export function caller_35d2a464(): number {
  return expectsNumber_35d2a464("not a number" as unknown as number);
}
