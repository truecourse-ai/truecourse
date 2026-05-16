function expectsNumber_7e2ffd18(x: number): number { return x * 2; }
export function caller_7e2ffd18(): number {
  return expectsNumber_7e2ffd18("not a number" as unknown as number);
}
