function expectsNumber_807dfd0c(x: number): number { return x * 2; }
export function caller_807dfd0c(): number {
  return expectsNumber_807dfd0c("not a number" as unknown as number);
}
