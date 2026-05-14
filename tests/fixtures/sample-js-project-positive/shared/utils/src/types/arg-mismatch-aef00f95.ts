function expectsNumber_aef00f95(x: number): number { return x * 2; }
export function caller_aef00f95(): number {
  return expectsNumber_aef00f95("not a number" as unknown as number);
}
