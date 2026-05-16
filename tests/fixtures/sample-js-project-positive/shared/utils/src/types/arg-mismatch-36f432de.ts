function expectsNumber_36f432de(x: number): number { return x * 2; }
export function caller_36f432de(): number {
  return expectsNumber_36f432de("not a number" as unknown as number);
}
