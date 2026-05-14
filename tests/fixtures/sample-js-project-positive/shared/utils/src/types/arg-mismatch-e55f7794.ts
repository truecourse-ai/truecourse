function expectsNumber_e55f7794(x: number): number { return x * 2; }
export function caller_e55f7794(): number {
  return expectsNumber_e55f7794("not a number" as unknown as number);
}
