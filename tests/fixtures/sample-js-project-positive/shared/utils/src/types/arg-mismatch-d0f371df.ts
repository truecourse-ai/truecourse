function expectsNumber_d0f371df(x: number): number { return x * 2; }
export function caller_d0f371df(): number {
  return expectsNumber_d0f371df("not a number" as unknown as number);
}
