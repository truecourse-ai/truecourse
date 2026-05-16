function expectsNumber_77e32264(x: number): number { return x * 2; }
export function caller_77e32264(): number {
  return expectsNumber_77e32264("not a number" as unknown as number);
}
