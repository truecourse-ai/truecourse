function expectsNumber_ad6faee8(x: number): number { return x * 2; }
export function caller_ad6faee8(): number {
  return expectsNumber_ad6faee8("not a number" as unknown as number);
}
