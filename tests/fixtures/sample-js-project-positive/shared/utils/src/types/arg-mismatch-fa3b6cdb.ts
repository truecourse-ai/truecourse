function expectsNumber_fa3b6cdb(x: number): number { return x * 2; }
export function caller_fa3b6cdb(): number {
  return expectsNumber_fa3b6cdb("not a number" as unknown as number);
}
