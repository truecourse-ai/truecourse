function expectsNumber_f8bb40f5(x: number): number { return x * 2; }
export function caller_f8bb40f5(): number {
  return expectsNumber_f8bb40f5("not a number" as unknown as number);
}
