function expectsNumber_aa9d0bb8(x: number): number { return x * 2; }
export function caller_aa9d0bb8(): number {
  return expectsNumber_aa9d0bb8("not a number" as unknown as number);
}
