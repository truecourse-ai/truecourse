function expectsNumber_ab2d9209(x: number): number { return x * 2; }
export function caller_ab2d9209(): number {
  return expectsNumber_ab2d9209("not a number" as unknown as number);
}
