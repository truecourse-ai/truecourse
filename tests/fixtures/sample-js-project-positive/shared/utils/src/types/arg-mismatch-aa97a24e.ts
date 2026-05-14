function expectsNumber_aa97a24e(x: number): number { return x * 2; }
export function caller_aa97a24e(): number {
  return expectsNumber_aa97a24e("not a number" as unknown as number);
}
