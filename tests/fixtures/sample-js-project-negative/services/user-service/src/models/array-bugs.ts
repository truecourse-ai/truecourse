/**
 * Array and collection patterns — contains array-related bugs.
 */

// VIOLATION: bugs/deterministic/array-callback-missing-return
export function mapWithoutReturn(items: number[]) {
  return items.map((item) => {
    const doubled = item * 2;
  });
}

// VIOLATION: bugs/deterministic/array-callback-return
export function filterWithoutReturn(items: number[]) {
  return items.filter((item) => {
    const isPositive = item > 0;
  });
}

// VIOLATION: bugs/deterministic/empty-collection-access
export function accessEmpty() {
  return [][0];
}

// VIOLATION: bugs/deterministic/array-sort-without-compare
export function unsafeSort(items: number[]) {
  return items.sort();
}

// VIOLATION: bugs/deterministic/array-delete
export function deleteFromArray(arr: any[]) {
  delete arr[1];
  return arr;
}

// VIOLATION: bugs/deterministic/for-in-array
export function forInOnArray(arr: number[]) {
  for (const key in arr) {
    console.log(key);
  }
}

// VIOLATION: bugs/deterministic/sparse-array
export function createSparse() {
  return [1, , 3, , 5];
}

// VIOLATION: bugs/deterministic/reduce-missing-initial
export function reduceNoInit(items: number[]) {
  return items.reduce((acc, val) => acc + val);
}

// VIOLATION: bugs/deterministic/misleading-array-reverse
export function copyReverse(arr: number[]) {
  const sorted = arr.reverse();
  return sorted;
}
