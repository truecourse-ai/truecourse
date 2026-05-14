function expectsNumber_57c52a18(x: number): number { return x * 2; }
export function caller_57c52a18(): number {
  return expectsNumber_57c52a18("not a number" as unknown as number);
}
