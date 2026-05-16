function expectsNumber_78a41a42(x: number): number { return x * 2; }
export function caller_78a41a42(): number {
  return expectsNumber_78a41a42("not a number" as unknown as number);
}
