/**
 * Bug violations related to array patterns.
 */

// VIOLATION: bugs/deterministic/array-callback-missing-return
// Arrow function with block body in .map() but no return statement
export function arrayCallbackMissingReturn(items: number[]) {
  return items.map((item) => {
    const doubled = item * 2;
  });
}

// VIOLATION: bugs/deterministic/array-callback-return
// Callback for .filter() has a block body with no return statement
export function arrayCallbackReturn(items: number[]) {
  return items.filter((item) => {
    const isPositive = item > 0;
  });
}

// VIOLATION: bugs/deterministic/empty-collection-access
// Accessing index on an empty array literal
export function emptyCollectionAccess() {
  return [][0];
}

// VIOLATION: bugs/deterministic/misleading-array-reverse
// Assigning result of arr.reverse() looks like it doesn't mutate original
export function misleadingReverse(arr: number[]) {
  const sorted = arr.reverse();
  return sorted;
}
