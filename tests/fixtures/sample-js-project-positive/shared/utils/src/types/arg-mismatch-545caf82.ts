function expectsNumber_545caf82(x: number): number { return x * 2; }
export function caller_545caf82(): number {
  return expectsNumber_545caf82("not a number" as unknown as number);
}
