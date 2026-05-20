// Split out of code-quality-advanced.ts to keep both files under the
// god-module threshold. Each function here still validates a specific
// rule heuristic; see comments on individual exports.

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

// Positive: floating-promise — sync functions whose names match old ASYNC_PREFIXES.
const DEFAULT_SIZE = 1024;
export function createBufferSync(size: number): ArrayBuffer {
  return new ArrayBuffer(size);
}
export function loadConfigSync(): { ready: boolean } {
  return { ready: true };
}
export function callSyncCreate(): ArrayBuffer {
  return createBufferSync(DEFAULT_SIZE);
}

// Positive: state-update-in-loop — bare setX() identifier call in a loop in a
// non-React file (this file does not import React, so the rule must skip).
declare const setStringValue: (s: string) => void;
export function applyTitles(items: readonly string[]): void {
  for (const item of items) {
    setStringValue(item);
  }
}

// Positive: static-method-candidate — Vue lifecycle method on a class extending
// a Vue base. Classes that extend ANY base are skipped via the heritage check.
declare const VueBase: { new(): { mounted(): void } };
class MyVueComponent extends VueBase {
  mounted(): void {
    console.warn('mounted');
  }
}
export const vueComponent = new MyVueComponent();
