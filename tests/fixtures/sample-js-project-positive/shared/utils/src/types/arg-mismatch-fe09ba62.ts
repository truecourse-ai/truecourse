function expectsNumber_fe09ba62(x: number): number { return x * 2; }
export function caller_fe09ba62(): number {
  return expectsNumber_fe09ba62("not a number" as unknown as number);
}
