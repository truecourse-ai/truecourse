function expectsNumber_ab3b108a(x: number): number { return x * 2; }
export function caller_ab3b108a(): number {
  return expectsNumber_ab3b108a("not a number" as unknown as number);
}
