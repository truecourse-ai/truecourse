function expectsNumber_c00becfc(x: number): number { return x * 2; }
export function caller_c00becfc(): number {
  return expectsNumber_c00becfc("not a number" as unknown as number);
}
