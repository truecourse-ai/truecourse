function expectsNumber_7a14efa0(x: number): number { return x * 2; }
export function caller_7a14efa0(): number {
  return expectsNumber_7a14efa0("not a number" as unknown as number);
}
