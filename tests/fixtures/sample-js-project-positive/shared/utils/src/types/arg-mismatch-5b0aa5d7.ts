function expectsNumber_5b0aa5d7(x: number): number { return x * 2; }
export function caller_5b0aa5d7(): number {
  return expectsNumber_5b0aa5d7("not a number" as unknown as number);
}
