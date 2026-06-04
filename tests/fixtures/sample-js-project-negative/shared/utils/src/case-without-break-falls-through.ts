// The real bug: a case body that simply executes a statement and then falls
// through to the next case without a break/return/throw.

export function describeFlag(flag: number): string {
  let label = '';
  switch (flag) {
    // VIOLATION: code-quality/deterministic/case-without-break
    case 0:
      label = 'zero';
    case 1:
      label = 'one';
      break;
    default:
      label = 'other';
      break;
  }
  return label;
}
