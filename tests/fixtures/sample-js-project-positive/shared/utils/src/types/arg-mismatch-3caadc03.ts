function expectsNumber_3caadc03(x: number): number { return x * 2; }
export function caller_3caadc03(): number {
  return expectsNumber_3caadc03("not a number" as unknown as number);
}
