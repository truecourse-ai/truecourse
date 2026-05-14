function expectsNumber_ff490901(x: number): number { return x * 2; }
export function caller_ff490901(): number {
  return expectsNumber_ff490901("not a number" as unknown as number);
}
