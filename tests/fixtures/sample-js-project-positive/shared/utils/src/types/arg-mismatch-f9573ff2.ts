function expectsNumber_f9573ff2(x: number): number { return x * 2; }
export function caller_f9573ff2(): number {
  return expectsNumber_f9573ff2("not a number" as unknown as number);
}
