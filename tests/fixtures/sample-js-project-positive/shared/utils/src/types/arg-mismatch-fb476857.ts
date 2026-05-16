function expectsNumber_fb476857(x: number): number { return x * 2; }
export function caller_fb476857(): number {
  return expectsNumber_fb476857("not a number" as unknown as number);
}
