function expectsNumber_bf9439be(x: number): number { return x * 2; }
export function caller_bf9439be(): number {
  return expectsNumber_bf9439be("not a number" as unknown as number);
}
