function expectsNumber_e89a8d61(x: number): number { return x * 2; }
export function caller_e89a8d61(): number {
  return expectsNumber_e89a8d61("not a number" as unknown as number);
}
