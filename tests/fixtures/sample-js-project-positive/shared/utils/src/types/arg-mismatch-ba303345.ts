function expectsNumber_ba303345(x: number): number { return x * 2; }
export function caller_ba303345(): number {
  return expectsNumber_ba303345("not a number" as unknown as number);
}
