function expectsNumber_79bbc237(x: number): number { return x * 2; }
export function caller_79bbc237(): number {
  return expectsNumber_79bbc237("not a number" as unknown as number);
}
