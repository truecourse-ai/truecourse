function expectsNumber_7fdb147a(x: number): number { return x * 2; }
export function caller_7fdb147a(): number {
  return expectsNumber_7fdb147a("not a number" as unknown as number);
}
