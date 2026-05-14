function expectsNumber_fd08cf73(x: number): number { return x * 2; }
export function caller_fd08cf73(): number {
  return expectsNumber_fd08cf73("not a number" as unknown as number);
}
