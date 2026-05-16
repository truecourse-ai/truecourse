function expectsNumber_a7e92753(x: number): number { return x * 2; }
export function caller_a7e92753(): number {
  return expectsNumber_a7e92753("not a number" as unknown as number);
}
