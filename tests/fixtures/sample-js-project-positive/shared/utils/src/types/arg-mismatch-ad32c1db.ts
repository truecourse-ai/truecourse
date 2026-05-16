function expectsNumber_ad32c1db(x: number): number { return x * 2; }
export function caller_ad32c1db(): number {
  return expectsNumber_ad32c1db("not a number" as unknown as number);
}
