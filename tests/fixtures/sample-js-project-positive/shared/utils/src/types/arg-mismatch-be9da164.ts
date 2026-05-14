function expectsNumber_be9da164(x: number): number { return x * 2; }
export function caller_be9da164(): number {
  return expectsNumber_be9da164("not a number" as unknown as number);
}
