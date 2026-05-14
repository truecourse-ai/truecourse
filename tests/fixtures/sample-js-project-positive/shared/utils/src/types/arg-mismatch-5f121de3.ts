function expectsNumber_5f121de3(x: number): number { return x * 2; }
export function caller_5f121de3(): number {
  return expectsNumber_5f121de3("not a number" as unknown as number);
}
