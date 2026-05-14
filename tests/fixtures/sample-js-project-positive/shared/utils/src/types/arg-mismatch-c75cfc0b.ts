function expectsNumber_c75cfc0b(x: number): number { return x * 2; }
export function caller_c75cfc0b(): number {
  return expectsNumber_c75cfc0b("not a number" as unknown as number);
}
