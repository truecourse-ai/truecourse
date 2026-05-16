function expectsNumber_b9b78d9d(x: number): number { return x * 2; }
export function caller_b9b78d9d(): number {
  return expectsNumber_b9b78d9d("not a number" as unknown as number);
}
