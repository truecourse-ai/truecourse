function expectsNumber_bf8dc259(x: number): number { return x * 2; }
export function caller_bf8dc259(): number {
  return expectsNumber_bf8dc259("not a number" as unknown as number);
}
