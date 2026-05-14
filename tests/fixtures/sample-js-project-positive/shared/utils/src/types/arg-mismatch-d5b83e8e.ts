function expectsNumber_d5b83e8e(x: number): number { return x * 2; }
export function caller_d5b83e8e(): number {
  return expectsNumber_d5b83e8e("not a number" as unknown as number);
}
