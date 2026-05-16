function expectsNumber_f055c3da(x: number): number { return x * 2; }
export function caller_f055c3da(): number {
  return expectsNumber_f055c3da("not a number" as unknown as number);
}
