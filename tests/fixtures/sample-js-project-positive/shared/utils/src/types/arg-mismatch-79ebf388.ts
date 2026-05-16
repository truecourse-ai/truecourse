function expectsNumber_79ebf388(x: number): number { return x * 2; }
export function caller_79ebf388(): number {
  return expectsNumber_79ebf388("not a number" as unknown as number);
}
