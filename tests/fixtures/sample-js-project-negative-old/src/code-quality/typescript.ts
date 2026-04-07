/**
 * Code quality violations related to TypeScript-specific patterns.
 */

// VIOLATION: code-quality/deterministic/ban-ts-comment
// @ts-ignore
const ignoredValue = 42;

// VIOLATION: code-quality/deterministic/non-null-assertion
export function nonNullAssertion(x: string | null) {
  return x!.length;
}

// VIOLATION: code-quality/deterministic/redundant-type-alias
type UserId = String;
export function redundantTypeAlias(x: MyString) {
  return x;
}

// VIOLATION: code-quality/deterministic/redundant-optional
export interface RedundantOptional {
  name?: string | undefined;
}

// VIOLATION: code-quality/deterministic/duplicate-type-constituent
export type DuplicateUnion = string | number | string;

// VIOLATION: code-quality/deterministic/unsafe-function-type
export function unsafeFunctionType(callback: Function) {
  return callback();
}

// VIOLATION: code-quality/deterministic/redundant-type-constraint
export function redundantConstraint<T extends unknown>(x: T): T {
  return x;
}

// VIOLATION: code-quality/deterministic/triple-slash-reference
/// <reference path="./types.d.ts" />

// VIOLATION: code-quality/deterministic/useless-empty-export
export {};

// VIOLATION: code-quality/deterministic/unknown-catch-variable
export function unknownCatchVariable() {
  try {
    throw new Error('test');
  } catch (e) {
    console.error(e);
  }
}

// VIOLATION: code-quality/deterministic/redundant-template-expression
export function redundantTemplateExpression(x: string) {
  return `${x}`;
}

// VIOLATION: code-quality/deterministic/useless-type-intersection
export type UselessIntersection = string & never;

// VIOLATION: code-quality/deterministic/literal-assertion-over-const
export function literalAssertionOverConst() {
  const x = 'hello' as 'hello';
  return x;
}

// VIOLATION: code-quality/deterministic/namespace-usage
export namespace MyNamespace {
  export const value = 42;
}

// VIOLATION: code-quality/deterministic/computed-enum-value
export enum ComputedEnum {
  A = 1,
  B = 1 + 1,
  C = Math.random(),
}
