// Negative case: a plain exported arrow function with no variable-level type
// annotation should still require explicit parameter types.

// VIOLATION: code-quality/deterministic/required-type-annotations
export const combineValues = (left, right: number): number => {
  return Number(left) + right;
};

// VIOLATION: code-quality/deterministic/required-type-annotations
export const sumPair = (first, second: number): number => {
  return Number(first) + second;
};
