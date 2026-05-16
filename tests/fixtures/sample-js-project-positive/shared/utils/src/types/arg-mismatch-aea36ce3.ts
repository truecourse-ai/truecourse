function expectsNumber_aea36ce3(x: number): number { return x * 2; }
export function caller_aea36ce3(): number {
  return expectsNumber_aea36ce3("not a number" as unknown as number);
}
