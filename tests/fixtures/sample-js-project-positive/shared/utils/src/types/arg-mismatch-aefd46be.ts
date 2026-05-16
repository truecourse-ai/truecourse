function expectsNumber_aefd46be(x: number): number { return x * 2; }
export function caller_aefd46be(): number {
  return expectsNumber_aefd46be("not a number" as unknown as number);
}
