function expectsNumber_bd2831a5(x: number): number { return x * 2; }
export function caller_bd2831a5(): number {
  return expectsNumber_bd2831a5("not a number" as unknown as number);
}
