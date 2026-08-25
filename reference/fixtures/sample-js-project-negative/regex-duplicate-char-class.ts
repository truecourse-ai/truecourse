// A character class that accidentally lists the same delimiter twice. The
// author meant to match comma, semicolon, or whitespace, but typed the
// semicolon twice — a redundant member that signals a copy-paste slip.

// VIOLATION: code-quality/deterministic/regex-duplicate-char-class
const delimiter = /[,;; ]/g;

export function splitFields(input: string): string[] {
  return input.split(delimiter).filter(Boolean);
}
