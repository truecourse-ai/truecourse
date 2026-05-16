function expectsNumber_56175e87(x: number): number { return x * 2; }
export function caller_56175e87(): number {
  return expectsNumber_56175e87("not a number" as unknown as number);
}
