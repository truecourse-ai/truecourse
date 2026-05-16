function expectsNumber_54828755(x: number): number { return x * 2; }
export function caller_54828755(): number {
  return expectsNumber_54828755("not a number" as unknown as number);
}
