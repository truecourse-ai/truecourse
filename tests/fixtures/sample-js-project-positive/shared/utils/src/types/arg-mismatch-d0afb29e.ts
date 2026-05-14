function expectsNumber_d0afb29e(x: number): number { return x * 2; }
export function caller_d0afb29e(): number {
  return expectsNumber_d0afb29e("not a number" as unknown as number);
}
