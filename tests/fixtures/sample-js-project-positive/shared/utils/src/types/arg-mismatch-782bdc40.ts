function expectsNumber_782bdc40(x: number): number { return x * 2; }
export function caller_782bdc40(): number {
  return expectsNumber_782bdc40("not a number" as unknown as number);
}
