function expectsNumber_a520a007(x: number): number { return x * 2; }
export function caller_a520a007(): number {
  return expectsNumber_a520a007("not a number" as unknown as number);
}
