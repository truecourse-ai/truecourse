function expectsNumber_75ed9619(x: number): number { return x * 2; }
export function caller_75ed9619(): number {
  return expectsNumber_75ed9619("not a number" as unknown as number);
}
