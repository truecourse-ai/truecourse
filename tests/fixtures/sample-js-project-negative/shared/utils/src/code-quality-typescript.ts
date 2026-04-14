/**
 * TypeScript-specific code quality patterns.
 */

// VIOLATION: code-quality/deterministic/ban-ts-comment
// @ts-ignore
const ignoredValue = 42;

// VIOLATION: code-quality/deterministic/non-null-assertion
export function forceNonNull(x: string | null) {
  return x!.length;
}

// VIOLATION: code-quality/deterministic/redundant-type-alias
type UserId = String;

// VIOLATION: code-quality/deterministic/redundant-optional
export interface OptionalUndef {
  name?: string | undefined;
}

// VIOLATION: code-quality/deterministic/duplicate-type-constituent
export type DuplicateUnion = string | number | string;

// VIOLATION: code-quality/deterministic/unsafe-function-type
export function genericCallback(callback: Function) {
  return callback();
}

// VIOLATION: code-quality/deterministic/redundant-type-constraint
export function anyConstraint<T extends unknown>(x: T): T {
  return x;
}

// VIOLATION: code-quality/deterministic/triple-slash-reference
/// <reference path="./types.d.ts" />

// VIOLATION: code-quality/deterministic/useless-empty-export
export {};

// VIOLATION: code-quality/deterministic/unknown-catch-variable
export function catchUntyped() {
  try {
    throw new Error('test');
  } catch (e) {
    console.error(e);
  }
}

// VIOLATION: code-quality/deterministic/redundant-template-expression
export function templateString(x: string) {
  return `${x}`;
}

// VIOLATION: code-quality/deterministic/useless-type-intersection
export type NeverIntersection = string & never;

// VIOLATION: code-quality/deterministic/literal-assertion-over-const
export function constAssertion() {
  const x = 'hello' as 'hello';
  return x;
}

// VIOLATION: code-quality/deterministic/namespace-usage
export namespace Config {
  export const value = 42;
}

// VIOLATION: code-quality/deterministic/computed-enum-value
export enum ComputedEnum {
  A = 1,
  B = 1 + 1,
  C = Math.random(),
}

// VIOLATION: code-quality/deterministic/complex-type-alias
export type DeepType = Map<string, Array<Set<Record<string, Map<number, boolean>>>>>;

// VIOLATION: code-quality/deterministic/explicit-any-in-return
export function returnsAny(data: unknown): any {
  return data;
}

// VIOLATION: code-quality/deterministic/mixed-type-exports
export { type MixedType, mixedValue };
type MixedType = string;
const mixedValue = 42;

// VIOLATION: code-quality/deterministic/public-static-readonly
export class Constants {
  static MAX_SIZE = 100;
}

// VIOLATION: code-quality/deterministic/reduce-type-cast
export function reduceWithCast(arr: number[]) {
  return arr.reduce((acc, val) => [...acc, val], [] as number[]);
}

// VIOLATION: code-quality/deterministic/redundant-overload
function overloaded(x: number): string;
function overloaded(x: number, y: number): string;
function overloaded(x: number, y?: number): string {
  return String(x + (y ?? 0));
}
export { overloaded };

// VIOLATION: code-quality/deterministic/restricted-types
export function objectParam(val: Object) {
  return val;
}

// VIOLATION: code-quality/deterministic/required-type-annotations
export function noAnnotation(data) {
  return data;
}

// VIOLATION: code-quality/deterministic/require-import
export function requireInCode() {
  const fs = require('fs');
  return fs;
}

// VIOLATION: code-quality/deterministic/too-many-union-members
export type ManyUnion = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';

// VIOLATION: code-quality/deterministic/type-guard-preference
export function isString(x: unknown): boolean {
  return typeof x === 'string';
}

// VIOLATION: code-quality/deterministic/prefer-this-return-type
export class Builder {
  private values: string[] = [];
  add(val: string): Builder {
    this.values.push(val);
    return this;
  }
}

// VIOLATION: code-quality/deterministic/confusing-void-expression
function sideEffect(): void {
  console.log('done');
}
export function confusingVoid() {
  const result = sideEffect();
  return result;
}

// VIOLATION: code-quality/deterministic/unnecessary-namespace-qualifier
export enum StatusEnum {
  Active = 1,
  Inactive = StatusEnum.Active + 1,
}

// VIOLATION: code-quality/deterministic/unnecessary-parameter-property-assignment
export class ParamAssign {
  constructor(public name: string = 'default') {
    this.name = 'default';
  }
}

// VIOLATION: code-quality/deterministic/useless-default-assignment
export class UselessDefault {
  constructor(public value: string = undefined) {}
}

declare const UserId: any;
declare const ignoredValueRef: any;
