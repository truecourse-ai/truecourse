function expectsNumber_a5cd03bf(x: number): number { return x * 2; }
export function caller_a5cd03bf(): number {
  return expectsNumber_a5cd03bf("not a number" as unknown as number);
}
