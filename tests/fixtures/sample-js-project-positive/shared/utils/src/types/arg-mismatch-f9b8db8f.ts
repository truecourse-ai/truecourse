function expectsNumber_f9b8db8f(x: number): number { return x * 2; }
export function caller_f9b8db8f(): number {
  return expectsNumber_f9b8db8f("not a number" as unknown as number);
}
