function expectsNumber_fda38ba0(x: number): number { return x * 2; }
export function caller_fda38ba0(): number {
  return expectsNumber_fda38ba0("not a number" as unknown as number);
}
