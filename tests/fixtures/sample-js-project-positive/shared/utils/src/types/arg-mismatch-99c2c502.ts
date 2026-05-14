function expectsNumber_99c2c502(x: number): number { return x * 2; }
export function caller_99c2c502(): number {
  return expectsNumber_99c2c502("not a number" as unknown as number);
}
