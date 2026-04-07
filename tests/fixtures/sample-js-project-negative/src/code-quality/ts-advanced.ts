/**
 * Advanced TypeScript-specific code quality violations.
 */

// VIOLATION: code-quality/deterministic/complex-type-alias
export type ComplexTypeAlias = Map<string, Array<Set<Record<string, Map<number, boolean>>>>>;

// VIOLATION: code-quality/deterministic/explicit-any-in-return
export function explicitAnyReturnViolation(data: unknown): any {
  return data;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
export function missingBoundaryViolation(data: unknown) {
  return String(data);
}

// VIOLATION: code-quality/deterministic/mixed-type-exports
export { type MixedExportType, mixedExportValue };
type MixedExportType = string;
const mixedExportValue = 42;

// VIOLATION: code-quality/deterministic/mixed-type-imports
import { type SomeType, someValue } from './helpers';

// VIOLATION: code-quality/deterministic/mutable-private-member
export class MutablePrivateViolation {
  private name: string;
  constructor(name: string) {
    this.name = name;
  }
  getName() {
    return this.name;
  }
}

// VIOLATION: code-quality/deterministic/public-static-readonly
export class PublicStaticViolation {
  static MAX_SIZE = 100;
}

// VIOLATION: code-quality/deterministic/readonly-parameter-types
export function readonlyParamViolation(items: string[]) {
  return items.length;
}

// VIOLATION: code-quality/deterministic/reduce-type-cast
export function reduceTypeCastViolation(arr: number[]) {
  return arr.reduce((acc, val) => [...acc, val], [] as number[]);
}

// VIOLATION: code-quality/deterministic/redundant-overload
function overloaded(x: number): string;
function overloaded(x: number, y: number): string;
function overloaded(x: number, y?: number): string {
  return String(x + (y ?? 0));
}
export { overloaded };

// VIOLATION: code-quality/deterministic/redundant-type-argument
// (needsTypeQuery — structural sample for when typeQuery is active)
export const redundantTypeArgSet = new Set<any>();

// VIOLATION: code-quality/deterministic/restricted-types
export function restrictedTypesViolation(val: Object) {
  return val;
}

// VIOLATION: code-quality/deterministic/required-type-annotations
export function requiredAnnotationsViolation(data) {
  return data;
}

// VIOLATION: code-quality/deterministic/require-import
export function requireImportViolation() {
  const fs = require('fs');
  return fs;
}

// VIOLATION: code-quality/deterministic/too-many-union-members
export type TooManyUnionViolation = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';

// VIOLATION: code-quality/deterministic/type-guard-preference
export function typeGuardViolation(x: unknown): boolean {
  return typeof x === 'string';
}

// VIOLATION: code-quality/deterministic/type-import-side-effects
import { type SideEffectType } from './side-effect-module';

// VIOLATION: code-quality/deterministic/prefer-this-return-type
export class BuilderViolation {
  private values: string[] = [];
  add(val: string): BuilderViolation {
    this.values.push(val);
    return this;
  }
}

// VIOLATION: code-quality/deterministic/confusing-void-expression
function doSomething(): void {
  console.log('done');
}
export function confusingVoidViolation() {
  const result = doSomething();
  return result;
}

// VIOLATION: code-quality/deterministic/unnecessary-condition
// (needsTypeQuery — uses ternary with always-truthy symbol type)
export function unnecessaryCondViolation(sym: symbol) {
  return sym ? 'has symbol' : 'no symbol';
}

// VIOLATION: code-quality/deterministic/unnecessary-type-assertion
// (needsTypeQuery — structural sample)
export function unnecessaryTypeAssertionViolation(x: string) {
  return (x as string).length;
}

// VIOLATION: code-quality/deterministic/unnecessary-type-conversion
// (needsTypeQuery — structural sample)
export function unnecessaryTypeConversionViolation(x: string) {
  return String(x);
}

// VIOLATION: code-quality/deterministic/unnecessary-type-parameter
// (needsTypeQuery — structural sample)
export function unnecessaryTypeParamViolation<T>(x: T): void {
  console.log(x);
}

// VIOLATION: code-quality/deterministic/unnecessary-namespace-qualifier
export enum StatusViolation {
  Active = 1,
  Inactive = StatusViolation.Active + 1,
}

// VIOLATION: code-quality/deterministic/unnecessary-parameter-property-assignment
export class UnnecessaryParamAssignViolation {
  constructor(public name: string = 'default') {
    this.name = 'default';
  }
}

// VIOLATION: code-quality/deterministic/unsafe-any-usage
// (needsTypeQuery — structural sample)
declare function getUnsafeData(): any;
export function unsafeAnyViolation() {
  const result = getUnsafeData();
  return result.foo;
}

// VIOLATION: code-quality/deterministic/useless-default-assignment
export class UselessDefaultViolation {
  constructor(public value: string = undefined) {}
}

// Stubs to avoid import errors
declare const SomeType: any;
declare const someValue: any;
declare const SideEffectType: any;
