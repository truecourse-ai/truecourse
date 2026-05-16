function expectsNumber_75d47a3d(x: number): number { return x * 2; }
export function caller_75d47a3d(): number {
  return expectsNumber_75d47a3d("not a number" as unknown as number);
}
