function expectsNumber_3b58a0cd(x: number): number { return x * 2; }
export function caller_3b58a0cd(): number {
  return expectsNumber_3b58a0cd("not a number" as unknown as number);
}
