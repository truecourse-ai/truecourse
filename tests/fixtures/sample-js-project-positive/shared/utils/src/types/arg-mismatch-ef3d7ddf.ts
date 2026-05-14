function expectsNumber_ef3d7ddf(x: number): number { return x * 2; }
export function caller_ef3d7ddf(): number {
  return expectsNumber_ef3d7ddf("not a number" as unknown as number);
}
