function expectsNumber_40838eca(x: number): number { return x * 2; }
export function caller_40838eca(): number {
  return expectsNumber_40838eca("not a number" as unknown as number);
}
