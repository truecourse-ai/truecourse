function expectsNumber_7bd07c2a(x: number): number { return x * 2; }
export function caller_7bd07c2a(): number {
  return expectsNumber_7bd07c2a("not a number" as unknown as number);
}
