function expectsNumber_0e34571f(x: number): number { return x * 2; }
export function caller_0e34571f(): number {
  return expectsNumber_0e34571f("not a number" as unknown as number);
}
