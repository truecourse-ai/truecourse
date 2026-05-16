function expectsNumber_d39e595b(x: number): number { return x * 2; }
export function caller_d39e595b(): number {
  return expectsNumber_d39e595b("not a number" as unknown as number);
}
