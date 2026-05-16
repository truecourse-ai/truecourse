function expectsNumber_7c49af16(x: number): number { return x * 2; }
export function caller_7c49af16(): number {
  return expectsNumber_7c49af16("not a number" as unknown as number);
}
