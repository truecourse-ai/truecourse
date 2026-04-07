/**
 * Code quality violations related to modern JS/TS patterns.
 */

// VIOLATION: code-quality/deterministic/prefer-rest-params
export function preferRestParams() {
  const args = arguments;
  return Array.from(args);
}

// VIOLATION: code-quality/deterministic/prefer-spread
export function preferSpread(arr: number[]) {
  return Math.max.apply(null, arr);
}

// VIOLATION: code-quality/deterministic/require-await
export async function requireAwait() {
  return 42;
}

// VIOLATION: code-quality/deterministic/require-yield
export function* requireYield() {
  return 42;
}

// VIOLATION: code-quality/deterministic/no-return-await
export async function noReturnAwait() {
  return await Promise.resolve(42);
}

// VIOLATION: code-quality/deterministic/prefer-includes
export function preferIncludes(arr: number[], item: number) {
  return arr.indexOf(item) !== -1;
}

// VIOLATION: code-quality/deterministic/prefer-template
export function preferTemplate(name: string) {
  return 'Hello, ' + name;
}

// VIOLATION: code-quality/deterministic/class-prototype-assignment
export class MyService {
  name = 'service';
}
MyService.prototype.toString = function() { return this.name; };

// VIOLATION: code-quality/deterministic/for-in-without-filter
export function forInWithoutFilter(obj: Record<string, number>) {
  const result: number[] = [];
  for (const key in obj) {
    result.push(obj[key]);
  }
  return result;
}

// VIOLATION: code-quality/deterministic/accessor-pairs
export const accessorPairs = {
  set value(v: number) {
    console.log(v);
  },
  // missing getter
};

// VIOLATION: code-quality/deterministic/elseif-without-else
export function elseifWithoutElse(x: number) {
  if (x > 10) {
    return 'big';
  } else if (x > 5) {
    return 'medium';
  }
}

// VIOLATION: code-quality/deterministic/equals-in-for-termination
export function equalsInForTermination() {
  const result: number[] = [];
  for (let i = 0; i == 10; i++) {
    result.push(i);
  }
  return result;
}

// VIOLATION: code-quality/deterministic/star-import
import * as fs from 'fs';
export function starImport() {
  return fs.readFileSync;
}
