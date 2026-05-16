function expectsNumber_7c6ee578(x: number): number { return x * 2; }
export function caller_7c6ee578(): number {
  return expectsNumber_7c6ee578("not a number" as unknown as number);
}
