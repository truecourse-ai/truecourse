// Negative cases that the rule must still catch after the Unicode-escape
// parsing fix.

// True duplicate of a literal character — the rule should still flag this.
// VIOLATION: code-quality/deterministic/regex-duplicate-char-class
export function matchesLiteralDup(input: string): boolean {
  return /[AA]/.test(input);
}

// True duplicate of a braced \u{XXXX} escape under the `u` flag.
// VIOLATION: code-quality/deterministic/regex-duplicate-char-class
export function matchesBracedEscapeDup(input: string): boolean {
  return /[\u{0041}\u{0041}]/u.test(input);
}
