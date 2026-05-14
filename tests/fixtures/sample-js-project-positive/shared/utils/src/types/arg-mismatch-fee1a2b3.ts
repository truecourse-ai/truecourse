function expectsNumber_fee1a2b3(x: number): number { return x * 2; }
export function caller_fee1a2b3(): number {
  return expectsNumber_fee1a2b3("not a number" as unknown as number);
}
