/**
 * Comparison and type-checking utilities -- proper implementations.
 */

export function isNaNCheck(x: number): boolean {
  return Number.isNaN(x);
}

export function isNotNaN(x: number): boolean {
  return !Number.isNaN(x);
}

export function checkNaN(value: number): boolean {
  return Number.isNaN(value);
}

export function checkNegZero(x: number): boolean {
  return Object.is(x, -0);
}

export function checkType(x: unknown): x is string {
  return typeof x === 'string';
}

const EXPECTED_VALUE = 42;
const ACTUAL_VALUE = 42;
export function typedComparison(): boolean {
  return EXPECTED_VALUE === ACTUAL_VALUE;
}

export function properInCheck(obj: Record<string, unknown>): boolean {
  return 'length' in obj;
}
export function stringEquality(a: string, b: string): boolean {
  return a === b;
}
export function numericLiteralArithmetic(items: readonly string[]): number[] {
  return items.map((_, i) => i * 2);
}
