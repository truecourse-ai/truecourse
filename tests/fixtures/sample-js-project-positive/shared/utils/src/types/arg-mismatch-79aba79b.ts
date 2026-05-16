function expectsNumber_79aba79b(x: number): number { return x * 2; }
export function caller_79aba79b(): number {
  return expectsNumber_79aba79b("not a number" as unknown as number);
}
