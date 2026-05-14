function expectsNumber_0cce8573(x: number): number { return x * 2; }
export function caller_0cce8573(): number {
  return expectsNumber_0cce8573("not a number" as unknown as number);
}
