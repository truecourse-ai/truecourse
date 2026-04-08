import { logger } from '@sample/shared-utils';
export function safeParseError(): unknown {
  try { return JSON.parse('invalid'); } catch { logger.error('Parse error'); return null; }
}
export function wrapError(): never {
  try { throw new Error('original'); } catch { throw new Error('Wrapped error'); }
}
export function safeOptionalChain(obj: { fn?: () => number } | null): number | null {
  if (obj === null || obj.fn === undefined) return null;
  return obj.fn();
}
export function rejectWithError(): Promise<never> {
  return Promise.reject(new TypeError('validation failed'));
}
export async function asyncCatch(): Promise<unknown> {
  try { return await fetch('/api').then((r) => r.json()); } catch { logger.error('Failed'); return null; }
}
