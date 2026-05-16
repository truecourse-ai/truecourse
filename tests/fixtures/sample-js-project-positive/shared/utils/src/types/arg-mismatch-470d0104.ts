function expectsNumber_470d0104(x: number): number { return x * 2; }
export function caller_470d0104(): number {
  return expectsNumber_470d0104("not a number" as unknown as number);
}
