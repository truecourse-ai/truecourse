function expectsNumber_45dc0a90(x: number): number { return x * 2; }
export function caller_45dc0a90(): number {
  return expectsNumber_45dc0a90("not a number" as unknown as number);
}
