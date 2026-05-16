function expectsNumber_c89946df(x: number): number { return x * 2; }
export function caller_c89946df(): number {
  return expectsNumber_c89946df("not a number" as unknown as number);
}
