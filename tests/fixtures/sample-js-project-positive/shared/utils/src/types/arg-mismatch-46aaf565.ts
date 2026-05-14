function expectsNumber_46aaf565(x: number): number { return x * 2; }
export function caller_46aaf565(): number {
  return expectsNumber_46aaf565("not a number" as unknown as number);
}
