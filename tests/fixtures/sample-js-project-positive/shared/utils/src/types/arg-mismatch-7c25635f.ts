function expectsNumber_7c25635f(x: number): number { return x * 2; }
export function caller_7c25635f(): number {
  return expectsNumber_7c25635f("not a number" as unknown as number);
}
