function expectsNumber_fb45706d(x: number): number { return x * 2; }
export function caller_fb45706d(): number {
  return expectsNumber_fb45706d("not a number" as unknown as number);
}
