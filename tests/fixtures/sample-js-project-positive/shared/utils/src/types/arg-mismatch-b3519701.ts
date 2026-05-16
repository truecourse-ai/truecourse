function expectsNumber_b3519701(x: number): number { return x * 2; }
export function caller_b3519701(): number {
  return expectsNumber_b3519701("not a number" as unknown as number);
}
