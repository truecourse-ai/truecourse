// `delete arr[i]` on an array leaves a hole at that index (the
// `length` is unchanged, iteration yields `undefined`). Use `splice`.

export function dropAtIndex(items: number[], index: number): number[] {
  // VIOLATION: bugs/deterministic/array-delete
  delete items[index];
  return items;
}

export function clearFirst<T>(): (T | undefined)[] {
  const arr: T[] = [];
  // VIOLATION: bugs/deterministic/array-delete
  delete arr[0];
  return arr;
}
