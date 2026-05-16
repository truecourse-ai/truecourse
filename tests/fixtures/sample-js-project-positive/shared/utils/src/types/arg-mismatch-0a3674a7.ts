function expectsNumber_0a3674a7(x: number): number { return x * 2; }
export function caller_0a3674a7(): number {
  return expectsNumber_0a3674a7("not a number" as unknown as number);
}
