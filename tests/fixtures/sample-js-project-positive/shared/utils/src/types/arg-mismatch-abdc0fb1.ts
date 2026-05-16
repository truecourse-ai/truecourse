function expectsNumber_abdc0fb1(x: number): number { return x * 2; }
export function caller_abdc0fb1(): number {
  return expectsNumber_abdc0fb1("not a number" as unknown as number);
}
