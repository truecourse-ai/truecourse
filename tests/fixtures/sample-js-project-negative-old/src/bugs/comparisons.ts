/**
 * Bug violations related to comparison patterns.
 */

// VIOLATION: bugs/deterministic/self-comparison
export function selfComparisonExample(x: number) {
  if (x === x) {
    return true;
  }
  return false;
}

// VIOLATION: bugs/deterministic/no-self-compare
export function noSelfCompareExample(x: number) {
  return x !== x;
}

// VIOLATION: bugs/deterministic/use-isnan
export function useIsNanExample(value: number) {
  if (value === NaN) {
    return true;
  }
  return false;
}

// VIOLATION: bugs/deterministic/compare-neg-zero
export function compareNegZeroExample(x: number) {
  if (x === -0) {
    return true;
  }
  return false;
}

// VIOLATION: bugs/deterministic/invalid-typeof
export function invalidTypeofExample(x: unknown) {
  if (typeof x === 'strig') {
    return true;
  }
  return false;
}

// VIOLATION: bugs/deterministic/dissimilar-type-comparison
export function dissimilarTypeComparison() {
  // @ts-ignore
  return 42 === 'hello';
}

// VIOLATION: bugs/deterministic/in-operator-on-primitive
export function inOperatorOnPrimitive() {
  // @ts-ignore
  return 'length' in 42;
}
