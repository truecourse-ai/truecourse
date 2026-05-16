function expectsNumber_b80a49a5(x: number): number { return x * 2; }
export function caller_b80a49a5(): number {
  return expectsNumber_b80a49a5("not a number" as unknown as number);
}
