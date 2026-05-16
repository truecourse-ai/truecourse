function expectsNumber_384bd1cd(x: number): number { return x * 2; }
export function caller_384bd1cd(): number {
  return expectsNumber_384bd1cd("not a number" as unknown as number);
}
