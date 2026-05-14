function expectsNumber_f5571933(x: number): number { return x * 2; }
export function caller_f5571933(): number {
  return expectsNumber_f5571933("not a number" as unknown as number);
}
