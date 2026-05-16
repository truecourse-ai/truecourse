function expectsNumber_44d05113(x: number): number { return x * 2; }
export function caller_44d05113(): number {
  return expectsNumber_44d05113("not a number" as unknown as number);
}
