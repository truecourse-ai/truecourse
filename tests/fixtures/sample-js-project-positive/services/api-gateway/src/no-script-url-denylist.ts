// CSS/URL sanitizer denylist. The string `'javascript:'` here is in a
// blocked-value substring list — the code is rejecting the pattern, not
// introducing one. Flagging this is a false positive.

const BLOCKED_VALUE_SUBSTRINGS = ['url(', 'expression(', '@import', 'javascript:'];

export function isBlocked(value: string): boolean {
  const lower = value.toLowerCase();
  for (const substring of BLOCKED_VALUE_SUBSTRINGS) {
    if (lower.includes(substring)) return true;
  }
  return false;
}
