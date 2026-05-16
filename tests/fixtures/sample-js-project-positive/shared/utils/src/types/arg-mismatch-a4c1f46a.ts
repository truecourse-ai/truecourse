function expectsNumber_a4c1f46a(x: number): number { return x * 2; }
export function caller_a4c1f46a(): number {
  return expectsNumber_a4c1f46a("not a number" as unknown as number);
}
