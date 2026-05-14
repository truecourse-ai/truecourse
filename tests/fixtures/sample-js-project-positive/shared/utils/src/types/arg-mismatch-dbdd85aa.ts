function expectsNumber_dbdd85aa(x: number): number { return x * 2; }
export function caller_dbdd85aa(): number {
  return expectsNumber_dbdd85aa("not a number" as unknown as number);
}
