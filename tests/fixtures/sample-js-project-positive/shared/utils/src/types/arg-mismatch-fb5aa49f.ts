function expectsNumber_fb5aa49f(x: number): number { return x * 2; }
export function caller_fb5aa49f(): number {
  return expectsNumber_fb5aa49f("not a number" as unknown as number);
}
