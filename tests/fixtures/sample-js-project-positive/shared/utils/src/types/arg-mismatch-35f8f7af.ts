function expectsNumber_35f8f7af(x: number): number { return x * 2; }
export function caller_35f8f7af(): number {
  return expectsNumber_35f8f7af("not a number" as unknown as number);
}
