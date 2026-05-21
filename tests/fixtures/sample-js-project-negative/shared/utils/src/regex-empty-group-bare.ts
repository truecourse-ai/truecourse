// Negative cases: a true empty capture group `()` outside of any character
// class — matches the empty string and is almost always a mistake.

// VIOLATION: code-quality/deterministic/regex-empty-group
const emptyGroupAlpha = /foo()bar/;

// VIOLATION: code-quality/deterministic/regex-empty-group
const emptyGroupAtEnd = /^abc()/;

export function probeEmptyAlpha(value: string): boolean {
  return emptyGroupAlpha.test(value);
}

export function probeEmptyAtEnd(value: string): boolean {
  return emptyGroupAtEnd.test(value);
}
