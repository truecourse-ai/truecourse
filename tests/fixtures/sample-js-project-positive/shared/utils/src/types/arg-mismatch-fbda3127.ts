function expectsNumber_fbda3127(x: number): number { return x * 2; }
export function caller_fbda3127(): number {
  return expectsNumber_fbda3127("not a number" as unknown as number);
}
