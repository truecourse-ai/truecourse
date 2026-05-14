function expectsNumber_8e15d074(x: number): number { return x * 2; }
export function caller_8e15d074(): number {
  return expectsNumber_8e15d074("not a number" as unknown as number);
}
