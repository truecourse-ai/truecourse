/**
 * Bug violations related to regular expression patterns.
 */

// VIOLATION: bugs/deterministic/ambiguous-div-regex
// Regex starting with = looks like /= division-assignment operator
const ambiguousRegex = /=test/;

// VIOLATION: bugs/deterministic/control-chars-in-regex
// This rule detects literal control character bytes (0x01-0x1f) in regex pattern text.
// The regex below contains a literal SOH (0x01) byte embedded in the pattern.
const controlCharRegex = /abcdef/;

// VIOLATION: bugs/deterministic/invalid-regexp
// new RegExp with invalid pattern that throws SyntaxError
const invalidRegex = new RegExp('[invalid');

// VIOLATION: bugs/deterministic/redos-vulnerable-regex
// Nested quantifiers cause catastrophic backtracking
const redosRegex = /(a+)+$/;

// VIOLATION: bugs/deterministic/regex-group-reference-mismatch
// Replacement references $2 but regex only has 1 capturing group
export function regexGroupMismatch(input: string) {
  return input.replace(/(test)/, '$2-replaced');
}

// VIOLATION: bugs/deterministic/misleading-character-class
// Character class with literal emoji (U+1F600, codepoint > 0xFFFF) without u flag.
// JavaScript represents this as a surrogate pair, so the class matches individual surrogates.
const emojiCharClass = /[a-z😀]/;

// VIOLATION: bugs/deterministic/useless-backreference
// Backreference \1 appears before its group is defined
const uselessBackref = /\1(abc)/;

// VIOLATION: bugs/deterministic/nonstandard-decimal-escape
// String with \8 or \9 — non-standard decimal escapes
const nonstandardEscape = '\8is not a valid escape';

// VIOLATION: bugs/deterministic/octal-literal
// Legacy octal literal (starts with 0 followed by octal digits)
const octalNum = 0777;

export function useRegexBugs(input: string) {
  return (
    ambiguousRegex.test(input) &&
    controlCharRegex.test(input) &&
    invalidRegex.test(input) &&
    redosRegex.test(input) &&
    emojiCharClass.test(input) &&
    uselessBackref.test(input) &&
    nonstandardEscape.length > 0 &&
    octalNum > 0
  );
}
