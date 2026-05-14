function expectsNumber_75d7eb6c(x: number): number { return x * 2; }
export function caller_75d7eb6c(): number {
  return expectsNumber_75d7eb6c("not a number" as unknown as number);
}
