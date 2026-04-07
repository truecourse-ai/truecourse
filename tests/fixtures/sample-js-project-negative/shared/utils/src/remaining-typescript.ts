/**
 * Remaining TypeScript-specific patterns.
 */

// VIOLATION: bugs/deterministic/argument-type-mismatch
function acceptString(s: string): string { return s; }
export function typeMismatch() {
  const num: number = 42;
  return acceptString(num);
}

// VIOLATION: code-quality/deterministic/filename-class-mismatch
export default class WrongNameClass {
  value = 42;
}

// VIOLATION: code-quality/deterministic/internal-api-usage
import { something } from 'lodash/internal/baseClone';

// VIOLATION: code-quality/deterministic/mixed-type-imports
import { type SomeType, someValue } from './helpers';

// VIOLATION: code-quality/deterministic/type-import-side-effects
import { type SideEffectType } from './side-effect-module';

// VIOLATION: code-quality/deterministic/redundant-type-argument
export const typedSet = new Set<any>();

// VIOLATION: code-quality/deterministic/unnecessary-condition
export function alwaysTruthySymbol(sym: symbol) {
  return sym ? 'has symbol' : 'no symbol';
}

// VIOLATION: code-quality/deterministic/unnecessary-type-assertion
export function assertString(x: string) {
  return (x as string).length;
}

// VIOLATION: code-quality/deterministic/unnecessary-type-conversion
export function convertString(x: string) {
  return String(x);
}

// VIOLATION: code-quality/deterministic/unnecessary-type-parameter
export function genericParam<T>(x: T): void {
  console.log(x);
}

// VIOLATION: code-quality/deterministic/unused-scope-definition
function unusedScopeDef() {
  const unusedLocal = 42;
  return 0;
}
export { unusedScopeDef };

// ARCH-VIOLATION: architecture/deterministic/missing-error-status-code
export function badErrorResponse(req: any, res: any) {
  res.json({ error: 'Something failed' });
}

// VIOLATION: architecture/deterministic/duplicate-import
import { readFileSync } from 'fs';
import { readFileSync as readSync } from 'fs';

export function useDuplicateImport() {
  return readFileSync && readSync;
}

declare const something: any;
declare const SomeType: any;
declare const someValue: any;
declare const SideEffectType: any;
