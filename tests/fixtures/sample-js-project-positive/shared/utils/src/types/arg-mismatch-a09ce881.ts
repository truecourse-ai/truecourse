function expectsNumber_a09ce881(x: number): number { return x * 2; }
export function caller_a09ce881(): number {
  return expectsNumber_a09ce881("not a number" as unknown as number);
}
