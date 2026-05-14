function expectsNumber_51f2e53e(x: number): number { return x * 2; }
export function caller_51f2e53e(): number {
  return expectsNumber_51f2e53e("not a number" as unknown as number);
}
