function expectsNumber_7f192f53(x: number): number { return x * 2; }
export function caller_7f192f53(): number {
  return expectsNumber_7f192f53("not a number" as unknown as number);
}
