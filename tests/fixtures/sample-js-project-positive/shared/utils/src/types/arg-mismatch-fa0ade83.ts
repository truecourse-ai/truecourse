function expectsNumber_fa0ade83(x: number): number { return x * 2; }
export function caller_fa0ade83(): number {
  return expectsNumber_fa0ade83("not a number" as unknown as number);
}
