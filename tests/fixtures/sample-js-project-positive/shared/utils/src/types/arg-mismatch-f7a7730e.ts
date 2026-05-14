function expectsNumber_f7a7730e(x: number): number { return x * 2; }
export function caller_f7a7730e(): number {
  return expectsNumber_f7a7730e("not a number" as unknown as number);
}
