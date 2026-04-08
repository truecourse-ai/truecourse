export function withUsed(): number { return 42; }
export function usedCollection(): string {
  const arr: number[] = [];
  arr.push(1);
  return `items: ${arr.length}`;
}
export function properAssign(x: number): number { return x + 1; }
export class UsedPrivate {
  private readonly secret = 42;
  getValue(): number { return this.secret; }
}
export function usedParams(a: number, b: number): number { return a + b; }
