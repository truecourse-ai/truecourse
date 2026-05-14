function expectsNumber_7b1a97f3(x: number): number { return x * 2; }
export function caller_7b1a97f3(): number {
  return expectsNumber_7b1a97f3("not a number" as unknown as number);
}
