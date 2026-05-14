function expectsNumber_a365a040(x: number): number { return x * 2; }
export function caller_a365a040(): number {
  return expectsNumber_a365a040("not a number" as unknown as number);
}
