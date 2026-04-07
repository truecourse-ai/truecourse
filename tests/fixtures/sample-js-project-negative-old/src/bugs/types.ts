/**
 * Bug violations related to TypeScript type patterns.
 */

// VIOLATION: bugs/deterministic/empty-object-type
export type EmptyObjectType = {};

// VIOLATION: bugs/deterministic/wrapper-object-type
export function wrapperObjectType(s: String, n: Number, b: Boolean) {
  return { s, n, b };
}

// VIOLATION: bugs/deterministic/invalid-void-type
export function invalidVoidType(param: void) {
  return param;
}

// VIOLATION: bugs/deterministic/getter-setter-type-mismatch
export class GetterSetterTypeMismatch {
  private _value: string = '';
  get value(): string {
    return this._value;
  }
  set value(v: number) {
    this._value = String(v);
  }
}

// VIOLATION: bugs/deterministic/confusing-non-null-assertion
export function confusingNonNullAssertion(x: number | null) {
  return x! == null;
}

// VIOLATION: bugs/deterministic/extra-non-null-assertion
export function extraNonNullAssertion(x: string | null) {
  return x!!.length;
}

// VIOLATION: bugs/deterministic/contradictory-optional-chain
export function contradictoryOptionalChain(obj: { nested?: { value?: string } }) {
  return obj.nested?.value!;
}

// VIOLATION: bugs/deterministic/mixed-enum-values
export enum MixedEnum {
  A = 0,
  B = 'hello',
  C = 1,
}

// VIOLATION: bugs/deterministic/unsafe-declaration-merging
interface UnsafeMerged {
  name: string;
}
class UnsafeMerged {
  age = 0;
}

// VIOLATION: bugs/deterministic/fragile-enum-ordering
export enum FragileEnum {
  First,
  Second,
  Third,
}

// VIOLATION: bugs/deterministic/contradictory-non-null-coalescing
export function contradictoryNonNullCoalescing(x: string | null) {
  return x! ?? 'default';
}
