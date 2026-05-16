function expectsNumber_4c2f3252(x: number): number { return x * 2; }
export function caller_4c2f3252(): number {
  return expectsNumber_4c2f3252("not a number" as unknown as number);
}
