/**
 * Array and collection patterns -- proper implementations.
 */

export function mapWithReturn(items: readonly number[]): number[] {
  return items.map((item) => item * 2);
}

export function filterWithReturn(items: readonly number[]): number[] {
  return items.filter((item) => item > 0);
}

export function accessSafely(items: readonly number[]): number | undefined {
  return items[0];
}

export function safeSort(items: readonly number[]): number[] {
  return [...items].sort((a, b) => a - b);
}

export function removeFromArray(arr: readonly unknown[], index: number): unknown[] {
  return arr.filter((_, i) => i !== index);
}

export function forOfOnArray(): number {
  let sum = 0;
  for (const item of [1, 2, 3]) {
    sum += item;
  }
  return sum;
}

export function createArray(): number[] {
  return [1, 3, 5];
}

export function reduceWithInit(items: readonly number[]): number {
  return items.reduce((acc, val) => acc + val, 0);
}

export function safeCopyReverse(arr: readonly number[]): number[] {
  return [...arr].reverse();
}

export function accessWithKeyInCheck(items: Record<string, number>, key: string): number {
  if (key in items) {
    return items[key];
  }
  return 0;
}

export function accessWithOptionalChaining(config: Record<string, { label: string }>, key: string): string {
  return config[key]?.label ?? 'unknown';
}

export function accessInBoundedLoop(items: readonly string[]): string {
  for (let i = 0; i < items.length - 1; i++) {
    if (items[i] === items[i + 1]) return items[i];
  }
  return '';
}

