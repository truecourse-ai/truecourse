function expectsNumber_ab4ca07f(x: number): number { return x * 2; }
export function caller_ab4ca07f(): number {
  return expectsNumber_ab4ca07f("not a number" as unknown as number);
}
