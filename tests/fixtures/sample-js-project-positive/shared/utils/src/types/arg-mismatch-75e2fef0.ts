function expectsNumber_75e2fef0(x: number): number { return x * 2; }
export function caller_75e2fef0(): number {
  return expectsNumber_75e2fef0("not a number" as unknown as number);
}
