function expectsNumber_f87ad875(x: number): number { return x * 2; }
export function caller_f87ad875(): number {
  return expectsNumber_f87ad875("not a number" as unknown as number);
}
