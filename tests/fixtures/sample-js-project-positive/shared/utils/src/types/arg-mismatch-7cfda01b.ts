function expectsNumber_7cfda01b(x: number): number { return x * 2; }
export function caller_7cfda01b(): number {
  return expectsNumber_7cfda01b("not a number" as unknown as number);
}
