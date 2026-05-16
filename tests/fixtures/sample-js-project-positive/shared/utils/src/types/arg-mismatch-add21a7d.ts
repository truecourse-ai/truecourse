function expectsNumber_add21a7d(x: number): number { return x * 2; }
export function caller_add21a7d(): number {
  return expectsNumber_add21a7d("not a number" as unknown as number);
}
