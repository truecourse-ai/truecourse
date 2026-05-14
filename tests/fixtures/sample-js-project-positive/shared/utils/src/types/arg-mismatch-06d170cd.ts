function expectsNumber_06d170cd(x: number): number { return x * 2; }
export function caller_06d170cd(): number {
  return expectsNumber_06d170cd("not a number" as unknown as number);
}
