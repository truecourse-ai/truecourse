function expectsNumber_35d91b37(x: number): number { return x * 2; }
export function caller_35d91b37(): number {
  return expectsNumber_35d91b37("not a number" as unknown as number);
}
