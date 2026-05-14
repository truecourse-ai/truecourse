function expectsNumber_214224a5(x: number): number { return x * 2; }
export function caller_214224a5(): number {
  return expectsNumber_214224a5("not a number" as unknown as number);
}
