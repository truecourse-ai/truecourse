function expectsNumber_f514aeb8(x: number): number { return x * 2; }
export function caller_f514aeb8(): number {
  return expectsNumber_f514aeb8("not a number" as unknown as number);
}
