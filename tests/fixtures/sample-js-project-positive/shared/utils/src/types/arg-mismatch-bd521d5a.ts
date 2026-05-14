function expectsNumber_bd521d5a(x: number): number { return x * 2; }
export function caller_bd521d5a(): number {
  return expectsNumber_bd521d5a("not a number" as unknown as number);
}
