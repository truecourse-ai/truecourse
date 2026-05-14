function expectsNumber_7e8b9217(x: number): number { return x * 2; }
export function caller_7e8b9217(): number {
  return expectsNumber_7e8b9217("not a number" as unknown as number);
}
