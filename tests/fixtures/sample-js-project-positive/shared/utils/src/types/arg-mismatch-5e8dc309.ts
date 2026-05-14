function expectsNumber_5e8dc309(x: number): number { return x * 2; }
export function caller_5e8dc309(): number {
  return expectsNumber_5e8dc309("not a number" as unknown as number);
}
