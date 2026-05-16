function expectsNumber_aa8443da(x: number): number { return x * 2; }
export function caller_aa8443da(): number {
  return expectsNumber_aa8443da("not a number" as unknown as number);
}
