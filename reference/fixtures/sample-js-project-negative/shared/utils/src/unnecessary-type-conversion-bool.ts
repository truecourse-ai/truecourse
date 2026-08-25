function wrapBool(flag: boolean) {
  // VIOLATION: code-quality/deterministic/unnecessary-type-conversion
  return Boolean(flag);
}

export const wrappedFlag = wrapBool(true);
