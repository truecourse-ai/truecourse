/**
 * Modern JavaScript patterns — covers prefer-* and legacy patterns.
 */

// VIOLATION: code-quality/deterministic/prefer-rest-params
export function oldArguments() {
  const args = arguments;
  return Array.from(args);
}

// VIOLATION: code-quality/deterministic/prefer-spread
export function applyMax(arr: number[]) {
  return Math.max.apply(null, arr);
}

// VIOLATION: code-quality/deterministic/require-await
export async function noAwait() {
  return 42;
}

// VIOLATION: code-quality/deterministic/require-yield
export function* noYield() {
  return 42;
}

// VIOLATION: code-quality/deterministic/no-return-await
export async function extraAwait() {
  return await Promise.resolve(42);
}

// VIOLATION: code-quality/deterministic/prefer-includes
export function indexOfCheck(arr: number[], item: number) {
  return arr.indexOf(item) !== -1;
}

// VIOLATION: code-quality/deterministic/prefer-template
export function concatStrings(name: string) {
  return 'Hello, ' + name;
}

// VIOLATION: code-quality/deterministic/class-prototype-assignment
export class Service {
  name = 'service';
}
Service.prototype.toString = function() { return this.name; };

// VIOLATION: code-quality/deterministic/for-in-without-filter
export function forInNoFilter(obj: Record<string, number>) {
  const result: number[] = [];
  for (const key in obj) {
    result.push(obj[key]);
  }
  return result;
}

// VIOLATION: code-quality/deterministic/accessor-pairs
export const setterOnly = {
  set value(v: number) {
    console.log(v);
  },
};

// VIOLATION: code-quality/deterministic/elseif-without-else
export function noFinalElse(x: number) {
  if (x > 10) {
    return 'big';
  } else if (x > 5) {
    return 'medium';
  }
}

// VIOLATION: code-quality/deterministic/equals-in-for-termination
export function equalityInFor() {
  const result: number[] = [];
  for (let i = 0; i == 10; i++) {
    result.push(i);
  }
  return result;
}

// VIOLATION: code-quality/deterministic/star-import
import * as fs from 'fs';
export function readSync() {
  return fs.readFileSync;
}
