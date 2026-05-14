function expectsNumber_54cf76a0(x: number): number { return x * 2; }
export function caller_54cf76a0(): number {
  return expectsNumber_54cf76a0("not a number" as unknown as number);
}
