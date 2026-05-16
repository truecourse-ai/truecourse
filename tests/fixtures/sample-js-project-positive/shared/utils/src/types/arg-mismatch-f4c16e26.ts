function expectsNumber_f4c16e26(x: number): number { return x * 2; }
export function caller_f4c16e26(): number {
  return expectsNumber_f4c16e26("not a number" as unknown as number);
}
