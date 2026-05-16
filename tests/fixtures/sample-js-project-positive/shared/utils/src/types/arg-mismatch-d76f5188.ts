function expectsNumber_d76f5188(x: number): number { return x * 2; }
export function caller_d76f5188(): number {
  return expectsNumber_d76f5188("not a number" as unknown as number);
}
