function expectsNumber_7b71cc48(x: number): number { return x * 2; }
export function caller_7b71cc48(): number {
  return expectsNumber_7b71cc48("not a number" as unknown as number);
}
