function expectsNumber_76dfbcd4(x: number): number { return x * 2; }
export function caller_76dfbcd4(): number {
  return expectsNumber_76dfbcd4("not a number" as unknown as number);
}
