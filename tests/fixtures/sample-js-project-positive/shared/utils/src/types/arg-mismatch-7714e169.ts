function expectsNumber_7714e169(x: number): number { return x * 2; }
export function caller_7714e169(): number {
  return expectsNumber_7714e169("not a number" as unknown as number);
}
