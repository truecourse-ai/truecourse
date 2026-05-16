function expectsNumber_d347cc02(x: number): number { return x * 2; }
export function caller_d347cc02(): number {
  return expectsNumber_d347cc02("not a number" as unknown as number);
}
