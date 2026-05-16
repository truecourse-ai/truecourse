function expectsNumber_77ad1ceb(x: number): number { return x * 2; }
export function caller_77ad1ceb(): number {
  return expectsNumber_77ad1ceb("not a number" as unknown as number);
}
