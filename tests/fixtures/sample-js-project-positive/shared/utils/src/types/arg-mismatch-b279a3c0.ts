function expectsNumber_b279a3c0(x: number): number { return x * 2; }
export function caller_b279a3c0(): number {
  return expectsNumber_b279a3c0("not a number" as unknown as number);
}
