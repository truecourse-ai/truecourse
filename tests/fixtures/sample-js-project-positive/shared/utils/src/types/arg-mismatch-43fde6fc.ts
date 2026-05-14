function expectsNumber_43fde6fc(x: number): number { return x * 2; }
export function caller_43fde6fc(): number {
  return expectsNumber_43fde6fc("not a number" as unknown as number);
}
