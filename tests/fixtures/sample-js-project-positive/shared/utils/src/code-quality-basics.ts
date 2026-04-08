export function processData(data: unknown): unknown { return data; }
export function alwaysTrue(): boolean { return true; }
export function showNotification(message: string): string { return `msg:${message}`; }
export function throwError(): never { throw new TypeError('validation error'); }
export function addOne(x: number): number { return x + 1; }
export function getPrototype(obj: Record<string, unknown>): unknown { return Object.getPrototypeOf(obj); }
export function mergeObjects(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> { return { ...a, ...b }; }
export function optionalChain(obj: { value: string } | null): string | undefined { return obj?.value; }
export function nullishCoalesce(x: string | null): string { return x ?? 'default'; }
export function getArrayLength(arr: readonly unknown[]): number { return arr.length; }
export const greeting = 'hello';

// Allow invitation validation without auth (accept still requires auth)
// This function handles both cases (success and failure)
// Returns the processed result (or null if not found)
export function commentedCodeClean(): string { return 'no false positives'; }
