/**
 * Remaining TypeScript-specific patterns -- clean implementations.
 */

import fs from 'fs';

function acceptString(s: string): string { return s; }
export function typeMatch(): string {
  const str = 'hello';
  return acceptString(str);
}

export class RemainingTypescript {
  value = 42;
}

export function useDedicated(): typeof fs {
  return fs;
}

export function alwaysTruthyCheck(sym: symbol | null): string {
  if (sym !== null) return 'has symbol';
  return 'no symbol';
}

export function identityString(x: string): number {
  return x.length;
}

export function toUpperCase(x: string): string {
  return x.toUpperCase();
}

export function logValue(x: unknown): string {
  return String(x);
}

function localHelper(): number {
  return 42;
}
export function useLocalHelper(): number {
  return localHelper();
}

const HTTP_INTERNAL_ERROR = 500;
export function errorResponse(_req: unknown, res: { status: (code: number) => { json: (data: unknown) => undefined } }): undefined {
  return res.status(HTTP_INTERNAL_ERROR).json({ error: 'Something failed' });
}
