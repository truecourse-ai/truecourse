function expectsNumber_fd15f021(x: number): number { return x * 2; }
export function caller_fd15f021(): number {
  return expectsNumber_fd15f021("not a number" as unknown as number);
}
