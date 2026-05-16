function expectsNumber_bb57b4f8(x: number): number { return x * 2; }
export function caller_bb57b4f8(): number {
  return expectsNumber_bb57b4f8("not a number" as unknown as number);
}
