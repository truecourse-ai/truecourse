function expectsNumber_44d04f5f(x: number): number { return x * 2; }
export function caller_44d04f5f(): number {
  return expectsNumber_44d04f5f("not a number" as unknown as number);
}
