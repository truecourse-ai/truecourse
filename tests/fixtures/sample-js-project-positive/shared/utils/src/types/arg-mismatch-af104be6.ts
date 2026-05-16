function expectsNumber_af104be6(x: number): number { return x * 2; }
export function caller_af104be6(): number {
  return expectsNumber_af104be6("not a number" as unknown as number);
}
