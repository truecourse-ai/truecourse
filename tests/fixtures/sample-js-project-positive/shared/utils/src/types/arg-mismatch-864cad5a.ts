function expectsNumber_864cad5a(x: number): number { return x * 2; }
export function caller_864cad5a(): number {
  return expectsNumber_864cad5a("not a number" as unknown as number);
}
