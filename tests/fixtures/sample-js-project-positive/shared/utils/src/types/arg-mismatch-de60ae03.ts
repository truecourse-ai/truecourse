function expectsNumber_de60ae03(x: number): number { return x * 2; }
export function caller_de60ae03(): number {
  return expectsNumber_de60ae03("not a number" as unknown as number);
}
