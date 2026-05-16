function expectsNumber_3981a4f7(x: number): number { return x * 2; }
export function caller_3981a4f7(): number {
  return expectsNumber_3981a4f7("not a number" as unknown as number);
}
