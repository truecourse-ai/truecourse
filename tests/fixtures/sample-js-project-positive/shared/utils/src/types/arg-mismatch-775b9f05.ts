function expectsNumber_775b9f05(x: number): number { return x * 2; }
export function caller_775b9f05(): number {
  return expectsNumber_775b9f05("not a number" as unknown as number);
}
