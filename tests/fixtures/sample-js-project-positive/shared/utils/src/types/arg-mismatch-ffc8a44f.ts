function expectsNumber_ffc8a44f(x: number): number { return x * 2; }
export function caller_ffc8a44f(): number {
  return expectsNumber_ffc8a44f("not a number" as unknown as number);
}
