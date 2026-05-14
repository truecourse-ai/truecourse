function expectsNumber_9b2a4135(x: number): number { return x * 2; }
export function caller_9b2a4135(): number {
  return expectsNumber_9b2a4135("not a number" as unknown as number);
}
