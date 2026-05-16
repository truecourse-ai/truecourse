function expectsNumber_e157c2e1(x: number): number { return x * 2; }
export function caller_e157c2e1(): number {
  return expectsNumber_e157c2e1("not a number" as unknown as number);
}
