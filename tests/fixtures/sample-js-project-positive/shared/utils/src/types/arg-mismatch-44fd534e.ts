function expectsNumber_44fd534e(x: number): number { return x * 2; }
export function caller_44fd534e(): number {
  return expectsNumber_44fd534e("not a number" as unknown as number);
}
