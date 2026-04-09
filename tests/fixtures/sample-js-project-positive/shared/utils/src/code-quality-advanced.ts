export function setVariable(): number { return 43; }
export function callFn(): number { return 42; }
export function getNumber(value: string): number { return Number(value); }
export function checkValue(x: number): string { if (x > 0) return 'truthy'; return 'falsy'; }
export function hasOwn(obj: Record<string, unknown>, key: string): boolean { return Object.hasOwn(obj, key); }
export function separateStatements(x: number): number { if (x > 0) return x; return -x; }
export function directFetch(): Promise<Response> { return fetch('/api'); }
export function compareStrings(a: string, b: string): number { return a.localeCompare(b); }
export function defaultLast(b: number, a: number = 0): number { return a + b; }
export function findFirst(arr: readonly number[]): number | undefined { return arr.find((x) => x > 0); }
export function startsWithCheck(str: string): boolean { return str.startsWith('prefix'); }
export function buildPayload(name: string, email: string, age: number): Record<string, unknown> {
  const verified = true;
  return { name, email, age, verified, createdAt: new Date() };
}
export function explicitUndefined(): undefined {
  return undefined;
}
export function toBool(val: unknown): boolean {
  return !!val;
}
export function mapItems(items: readonly string[]): string[] {
  const results: string[] = [];
  for (const item of items) {
    results.push(item.toUpperCase());
  }
  return results;
}

// positive: ts-declaration-style — interface with extends clause should NOT trigger
interface BaseConfig { timeout: number; }
export interface ExtendedConfig extends BaseConfig { retries: number; }

// positive: insecure-random — Math.random() for non-security array index should NOT trigger
export function getRandomElement<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Positive: unused-constructor-result — new URL for validation
export function validateUrl(input: string): boolean { try { new URL(input); return true; } catch { return false; } }

// Positive: complex-type-alias — simple string literal union
export type Status = 'active' | 'inactive' | 'pending' | 'archived' | 'deleted';

// Positive: indexed-loop-over-for-of — partial range loop (needs index arithmetic)
export function pairwise(items: readonly number[]): number { let sum = 0; for (let i = 0; i < items.length - 1; i++) { sum += items[i] + items[i + 1]; } return sum; }

// Positive: unused-collection — collection reassigned and returned
export function buildList(): string[] { let items: string[] = ['a']; items = [...items, 'b']; return items; }
