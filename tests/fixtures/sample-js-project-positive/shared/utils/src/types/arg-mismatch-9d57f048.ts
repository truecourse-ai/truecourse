function expectsNumber_9d57f048(x: number): number { return x * 2; }
export function caller_9d57f048(): number {
  return expectsNumber_9d57f048("not a number" as unknown as number);
}
