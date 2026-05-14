function expectsNumber_e7e08e2d(x: number): number { return x * 2; }
export function caller_e7e08e2d(): number {
  return expectsNumber_e7e08e2d("not a number" as unknown as number);
}
