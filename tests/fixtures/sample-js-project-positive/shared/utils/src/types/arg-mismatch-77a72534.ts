function expectsNumber_77a72534(x: number): number { return x * 2; }
export function caller_77a72534(): number {
  return expectsNumber_77a72534("not a number" as unknown as number);
}
