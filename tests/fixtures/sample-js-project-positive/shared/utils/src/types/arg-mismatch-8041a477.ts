function expectsNumber_8041a477(x: number): number { return x * 2; }
export function caller_8041a477(): number {
  return expectsNumber_8041a477("not a number" as unknown as number);
}
