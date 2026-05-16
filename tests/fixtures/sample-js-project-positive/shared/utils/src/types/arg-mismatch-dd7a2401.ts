function expectsNumber_dd7a2401(x: number): number { return x * 2; }
export function caller_dd7a2401(): number {
  return expectsNumber_dd7a2401("not a number" as unknown as number);
}
