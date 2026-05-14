function expectsNumber_fdc6e3a9(x: number): number { return x * 2; }
export function caller_fdc6e3a9(): number {
  return expectsNumber_fdc6e3a9("not a number" as unknown as number);
}
