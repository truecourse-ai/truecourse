export function safeNonNull(x: string | null): number { if (x === null) return 0; return x.length; }
export interface OptionalField { name?: string; }
export type StringOrNumber = string | number;
export function wrapString(x: string): string { return x; }
export const CONFIG_VALUE = 42;
export type SimpleMap = Map<string, boolean>;
export function returnsUnknown(data: unknown): unknown { return data; }
export function objectParam(val: Record<string, unknown>): Record<string, unknown> { return val; }
export function isString(x: unknown): x is string { return typeof x === 'string'; }
export function processValue(input: unknown): boolean {
  if (typeof input === 'undefined') { return false; }
  if (typeof input === 'object') { return input !== null; }
  const result = String(input);
  const trimmed = result.trim();
  return trimmed.length > 0;
}
