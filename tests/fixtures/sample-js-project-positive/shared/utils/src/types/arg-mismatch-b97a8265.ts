function expectsNumber_b97a8265(x: number): number { return x * 2; }
export function caller_b97a8265(): number {
  return expectsNumber_b97a8265("not a number" as unknown as number);
}
