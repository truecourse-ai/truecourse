function expectsNumber_50bb902b(x: number): number { return x * 2; }
export function caller_50bb902b(): number {
  return expectsNumber_50bb902b("not a number" as unknown as number);
}
