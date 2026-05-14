function expectsNumber_39316953(x: number): number { return x * 2; }
export function caller_39316953(): number {
  return expectsNumber_39316953("not a number" as unknown as number);
}
