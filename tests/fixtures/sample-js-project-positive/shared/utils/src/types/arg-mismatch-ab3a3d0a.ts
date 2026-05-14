function expectsNumber_ab3a3d0a(x: number): number { return x * 2; }
export function caller_ab3a3d0a(): number {
  return expectsNumber_ab3a3d0a("not a number" as unknown as number);
}
