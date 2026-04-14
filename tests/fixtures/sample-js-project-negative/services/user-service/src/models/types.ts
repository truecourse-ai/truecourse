/**
 * Type definitions and TypeScript-specific patterns.
 */

// VIOLATION: bugs/deterministic/empty-object-type
export type EmptyConfig = {};

// VIOLATION: bugs/deterministic/wrapper-object-type
export function convertValues(s: String, n: Number, b: Boolean) {
  return { s, n, b };
}

// VIOLATION: bugs/deterministic/invalid-void-type
export function unusableParam(param: void) {
  return param;
}

// VIOLATION: bugs/deterministic/getter-setter-type-mismatch
export class Config {
  private _timeout: string = '5000';
  get timeout(): string {
    return this._timeout;
  }
  set timeout(v: number) {
    this._timeout = String(v);
  }
}

// VIOLATION: bugs/deterministic/confusing-non-null-assertion
export function confusingAssertion(x: number | null) {
  return x! == null;
}

// VIOLATION: bugs/deterministic/extra-non-null-assertion
export function doubleAssertion(x: string | null) {
  return x!!.length;
}

// VIOLATION: bugs/deterministic/contradictory-optional-chain
export function contradictoryChain(obj: { nested?: { value?: string } }) {
  return obj.nested?.value!;
}

// VIOLATION: bugs/deterministic/mixed-enum-values
export enum Priority {
  Low = 0,
  Medium = 'medium',
  High = 1,
}

// VIOLATION: bugs/deterministic/unsafe-declaration-merging
interface Mergeable {
  name: string;
}
class Mergeable {
  age = 0;
}

// VIOLATION: bugs/deterministic/fragile-enum-ordering
export enum Direction {
  Up,
  Down,
  Left,
  Right,
}

// VIOLATION: bugs/deterministic/contradictory-non-null-coalescing
export function contradictoryCoalescing(x: string | null) {
  return x! ?? 'default';
}

// VIOLATION: bugs/deterministic/duplicate-case
export function handleAction(action: string) {
  switch (action) {
    case 'start':
      return 1;
    case 'stop':
      return 2;
    case 'start':
      return 3;
    default:
      return 0;
  }
}

// VIOLATION: bugs/deterministic/duplicate-keys
export function getDuplicateObj() {
  return {
    name: 'Alice',
    age: 30,
    name: 'Bob',
  };
}

// VIOLATION: bugs/deterministic/duplicate-class-members
export class ConfigStore {
  getValue() {
    return 'old';
  }
  getValue() {
    return 'new';
  }
}

// VIOLATION: bugs/deterministic/duplicate-enum-value
export enum HttpStatus {
  OK = 200,
  Created = 201,
  Success = 200,
}
