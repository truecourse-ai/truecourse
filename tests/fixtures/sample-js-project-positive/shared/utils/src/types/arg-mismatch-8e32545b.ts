function expectsNumber_8e32545b(x: number): number { return x * 2; }
export function caller_8e32545b(): number {
  return expectsNumber_8e32545b("not a number" as unknown as number);
}
