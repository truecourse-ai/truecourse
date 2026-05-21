function isNever(): string {
  // VIOLATION: code-quality/deterministic/unnecessary-condition
  if (false) {
    return 'never';
  }
  return 'always';
}

export const branchResult = isNever();
