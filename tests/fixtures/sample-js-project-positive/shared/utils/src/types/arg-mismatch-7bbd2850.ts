function expectsNumber_7bbd2850(x: number): number { return x * 2; }
export function caller_7bbd2850(): number {
  return expectsNumber_7bbd2850("not a number" as unknown as number);
}
