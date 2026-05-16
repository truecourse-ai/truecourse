function expectsNumber_568b0aab(x: number): number { return x * 2; }
export function caller_568b0aab(): number {
  return expectsNumber_568b0aab("not a number" as unknown as number);
}
