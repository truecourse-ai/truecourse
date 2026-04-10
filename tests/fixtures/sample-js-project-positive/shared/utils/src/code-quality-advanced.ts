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

// Positive: json-parse-in-loop — parsing different strings each iteration (not same string)
export function parseAll(items: readonly string[]): unknown[] {
  const results: unknown[] = [];
  for (const item of items) {
    try {
      results.push(JSON.parse(item));
    } catch {
      // skip invalid JSON
    }
  }
  return results;
}

// Positive: prototype-pollution — Object.entries iteration (safe, not bracket assignment from user input)
export function applyMapping(target: Record<string, string>, source: Record<string, string>): void {
  for (const [key, val] of Object.entries(source)) {
    target[key] = val;
  }
}

// Positive: missing-react-memo — TS generics with comparison operators must NOT be flagged as JSX.
// Pre-fix the rule used `text.includes('<') && text.includes('>')` and matched generics.
export function compareGeneric<T extends number>(a: T, b: T): number {
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

// Positive: missing-react-memo — nested generics in return type, no JSX
export function pairBuilder<K, V>(key: K, value: V): Map<K, V> {
  const map = new Map<K, V>();
  map.set(key, value);
  return map;
}

// Positive: floating-promise — sync function whose name happens to start with "create"
// Pre-fix this would be flagged because "create" was in ASYNC_PREFIXES.
// (Will be re-verified once Phase 4 migrates floating-promise to TypeQueryService.)
export function createBufferSync(size: number): ArrayBuffer {
  return new ArrayBuffer(size);
}

// ---------------------------------------------------------------------------
// Phase 3: framework overfit fixes
// ---------------------------------------------------------------------------

// Positive: state-update-in-loop — bare setX() identifier call in a loop in a
// non-React file. Pre-fix the rule fired on any /^set[A-Z]/ call in a loop;
// now gated by React import (this file does not import React).
declare const setStringValue: (s: string) => void;
export function applyTitles(items: readonly string[]): void {
  for (const item of items) {
    setStringValue(item);
  }
}

// Positive: static-method-candidate — Vue lifecycle method on a class extending
// a Vue base. Pre-fix the hardcoded React-only contractMethods list missed
// Vue/Angular/Svelte lifecycle methods. Now: classes that extend ANY base are
// skipped via the existing heritage check.
declare const VueBase: { new(): { mounted(): void } };
class MyVueComponent extends VueBase {
  mounted(): void {
    console.warn('mounted');
  }
}
export const vueComponent = new MyVueComponent();
