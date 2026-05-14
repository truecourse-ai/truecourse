function expectsNumber_b0b90f6c(x: number): number { return x * 2; }
export function caller_b0b90f6c(): number {
  return expectsNumber_b0b90f6c("not a number" as unknown as number);
}
