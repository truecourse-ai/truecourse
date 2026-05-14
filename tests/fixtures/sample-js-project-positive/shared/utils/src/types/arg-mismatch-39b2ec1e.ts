function expectsNumber_39b2ec1e(x: number): number { return x * 2; }
export function caller_39b2ec1e(): number {
  return expectsNumber_39b2ec1e("not a number" as unknown as number);
}
