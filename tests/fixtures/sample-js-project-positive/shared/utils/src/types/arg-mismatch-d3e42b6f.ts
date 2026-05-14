function expectsNumber_d3e42b6f(x: number): number { return x * 2; }
export function caller_d3e42b6f(): number {
  return expectsNumber_d3e42b6f("not a number" as unknown as number);
}
