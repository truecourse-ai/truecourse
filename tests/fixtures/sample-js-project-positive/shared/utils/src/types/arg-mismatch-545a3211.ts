function expectsNumber_545a3211(x: number): number { return x * 2; }
export function caller_545a3211(): number {
  return expectsNumber_545a3211("not a number" as unknown as number);
}
