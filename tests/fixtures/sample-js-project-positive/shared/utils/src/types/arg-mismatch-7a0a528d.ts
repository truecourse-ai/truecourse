function expectsNumber_7a0a528d(x: number): number { return x * 2; }
export function caller_7a0a528d(): number {
  return expectsNumber_7a0a528d("not a number" as unknown as number);
}
