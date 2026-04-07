/**
 * Comparison and type-checking utilities — contains comparison bug patterns.
 */

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function isDuplicate(x: number) {
  // VIOLATION: bugs/deterministic/self-comparison
  if (x === x) {
    return true;
  }
  return false;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function isNotSelf(x: number) {
  // VIOLATION: bugs/deterministic/no-self-compare
  return x !== x;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function checkNaN(value: number) {
  // VIOLATION: bugs/deterministic/use-isnan
  if (value === NaN) {
    return true;
  }
  return false;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function checkNegZero(x: number) {
  // VIOLATION: bugs/deterministic/compare-neg-zero
  if (x === -0) {
    return true;
  }
  return false;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function checkType(x: unknown) {
  // VIOLATION: bugs/deterministic/invalid-typeof
  if (typeof x === 'strig') {
    return true;
  }
  return false;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function mixedComparison() {
  // VIOLATION: bugs/deterministic/dissimilar-type-comparison
  // @ts-ignore
  return 42 === 'hello';
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function checkPrimitive() {
  // VIOLATION: bugs/deterministic/in-operator-on-primitive
  // @ts-ignore
  return 'length' in 42;
}
