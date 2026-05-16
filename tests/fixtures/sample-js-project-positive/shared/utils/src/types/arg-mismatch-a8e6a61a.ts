function expectsNumber_a8e6a61a(x: number): number { return x * 2; }
export function caller_a8e6a61a(): number {
  return expectsNumber_a8e6a61a("not a number" as unknown as number);
}
