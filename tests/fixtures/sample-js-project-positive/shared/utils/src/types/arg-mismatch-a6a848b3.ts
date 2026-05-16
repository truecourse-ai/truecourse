function expectsNumber_a6a848b3(x: number): number { return x * 2; }
export function caller_a6a848b3(): number {
  return expectsNumber_a6a848b3("not a number" as unknown as number);
}
