function expectsNumber_a80c3e25(x: number): number { return x * 2; }
export function caller_a80c3e25(): number {
  return expectsNumber_a80c3e25("not a number" as unknown as number);
}
