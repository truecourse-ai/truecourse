export const templateLiteral = 'user is a user';
export function throwError(): never { throw new Error('bad input'); }
export function normalPermissions(): number { return 0o644; }
export const safeNumber = 9007199254740991;
export function properIndexCheck(arr: readonly string[]): boolean { return arr.includes('item'); }
export function symbolWithDesc(): symbol { return Symbol('description'); }
export function safeNew(): Map<string, number> { return new Map(); }
export function addAndReturn(x: number): number { return x + 1; }
export function checkMapSize(map: Map<string, number>): boolean { return map.size > 0; }
export function parseWithRadix(input: string): number { return parseInt(input, 10); }
export function consistentType(x: number): string {
  if (x > 0) return 'positive';
  if (x < 0) return 'negative';
  return 'zero';
}
export function addNumbers(x: number, y: number): number { return x + y; }
export function toArray(s: string): string[] { return s.split(''); }
