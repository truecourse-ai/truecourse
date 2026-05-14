function expectsNumber_4443475e(x: number): number { return x * 2; }
export function caller_4443475e(): number {
  return expectsNumber_4443475e("not a number" as unknown as number);
}
