function expectsNumber_f2a46d36(x: number): number { return x * 2; }
export function caller_f2a46d36(): number {
  return expectsNumber_f2a46d36("not a number" as unknown as number);
}
