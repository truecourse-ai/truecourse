function expectsNumber_603cbca2(x: number): number { return x * 2; }
export function caller_603cbca2(): number {
  return expectsNumber_603cbca2("not a number" as unknown as number);
}
