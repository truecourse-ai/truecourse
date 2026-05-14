function expectsNumber_fd545e5b(x: number): number { return x * 2; }
export function caller_fd545e5b(): number {
  return expectsNumber_fd545e5b("not a number" as unknown as number);
}
