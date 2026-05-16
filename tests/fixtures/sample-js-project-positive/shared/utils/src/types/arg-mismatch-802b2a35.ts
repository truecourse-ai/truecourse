function expectsNumber_802b2a35(x: number): number { return x * 2; }
export function caller_802b2a35(): number {
  return expectsNumber_802b2a35("not a number" as unknown as number);
}
