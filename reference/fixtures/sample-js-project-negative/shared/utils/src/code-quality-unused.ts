/**
 * Unused code patterns — dead stores, unused variables, unused members.
 */

// VIOLATION: code-quality/deterministic/unused-variable
export function withUnused() {
  const unused = 42;
  return 0;
}

// VIOLATION: code-quality/deterministic/dead-store
export function deadStore() {
  let x = 42;
  x = 100;
  return 0;
}

// VIOLATION: code-quality/deterministic/unused-collection
export function emptyCollection() {
  const arr: number[] = [];
  return 'done';
}

// VIOLATION: code-quality/deterministic/redundant-assignment
export function selfAssign(x: number) {
  let result = x;
  result = result;
  return result;
}

// VIOLATION: code-quality/deterministic/unused-private-member
export class Secretive {
  private secret = 42;
  getValue() {
    return 0;
  }
}

// VIOLATION: code-quality/deterministic/unused-function-parameter
export function extraParam(a: number, b: number, c: number) {
  return a + b;
}

// VIOLATION: code-quality/deterministic/unused-constructor-result
export function throwAwayMap() {
  new Map();
  return 'done';
}
