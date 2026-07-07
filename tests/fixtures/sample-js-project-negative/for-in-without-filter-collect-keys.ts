// A true bug: for…in over an untyped object with no own-property filter, so
// inherited enumerable keys are collected alongside the object's own keys.

export function collectKeys(source: object): string[] {
  const keys: string[] = [];
  // VIOLATION: code-quality/deterministic/for-in-without-filter
  for (const key in source) {
    keys.push(key);
  }
  return keys;
}
