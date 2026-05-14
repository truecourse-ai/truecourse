function expectsNumber_4eaa9e8f(x: number): number { return x * 2; }
export function caller_4eaa9e8f(): number {
  return expectsNumber_4eaa9e8f("not a number" as unknown as number);
}
