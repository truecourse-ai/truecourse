function expectsNumber_98c36ac5(x: number): number { return x * 2; }
export function caller_98c36ac5(): number {
  return expectsNumber_98c36ac5("not a number" as unknown as number);
}
