function expectsNumber_873f4f6c(x: number): number { return x * 2; }
export function caller_873f4f6c(): number {
  return expectsNumber_873f4f6c("not a number" as unknown as number);
}
