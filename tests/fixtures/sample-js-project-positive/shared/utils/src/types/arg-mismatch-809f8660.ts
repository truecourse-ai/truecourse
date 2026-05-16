function expectsNumber_809f8660(x: number): number { return x * 2; }
export function caller_809f8660(): number {
  return expectsNumber_809f8660("not a number" as unknown as number);
}
