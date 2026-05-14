function expectsNumber_d3ca237c(x: number): number { return x * 2; }
export function caller_d3ca237c(): number {
  return expectsNumber_d3ca237c("not a number" as unknown as number);
}
