function expectsNumber_bae129c5(x: number): number { return x * 2; }
export function caller_bae129c5(): number {
  return expectsNumber_bae129c5("not a number" as unknown as number);
}
