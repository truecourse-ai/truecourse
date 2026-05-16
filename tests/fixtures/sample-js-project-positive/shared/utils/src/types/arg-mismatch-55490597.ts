function expectsNumber_55490597(x: number): number { return x * 2; }
export function caller_55490597(): number {
  return expectsNumber_55490597("not a number" as unknown as number);
}
