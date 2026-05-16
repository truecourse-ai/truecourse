function expectsNumber_7c676097(x: number): number { return x * 2; }
export function caller_7c676097(): number {
  return expectsNumber_7c676097("not a number" as unknown as number);
}
