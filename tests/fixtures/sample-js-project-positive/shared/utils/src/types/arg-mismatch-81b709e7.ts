function expectsNumber_81b709e7(x: number): number { return x * 2; }
export function caller_81b709e7(): number {
  return expectsNumber_81b709e7("not a number" as unknown as number);
}
