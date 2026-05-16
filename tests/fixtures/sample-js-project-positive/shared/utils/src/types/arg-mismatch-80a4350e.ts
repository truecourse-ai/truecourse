function expectsNumber_80a4350e(x: number): number { return x * 2; }
export function caller_80a4350e(): number {
  return expectsNumber_80a4350e("not a number" as unknown as number);
}
