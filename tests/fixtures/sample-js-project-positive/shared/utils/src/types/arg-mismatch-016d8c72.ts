function expectsNumber_016d8c72(x: number): number { return x * 2; }
export function caller_016d8c72(): number {
  return expectsNumber_016d8c72("not a number" as unknown as number);
}
