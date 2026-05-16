function expectsNumber_e35953d7(x: number): number { return x * 2; }
export function caller_e35953d7(): number {
  return expectsNumber_e35953d7("not a number" as unknown as number);
}
