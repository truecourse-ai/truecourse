function expectsNumber_f642832b(x: number): number { return x * 2; }
export function caller_f642832b(): number {
  return expectsNumber_f642832b("not a number" as unknown as number);
}
