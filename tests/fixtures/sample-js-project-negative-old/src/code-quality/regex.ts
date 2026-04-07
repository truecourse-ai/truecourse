/**
 * Code quality violations related to regex patterns.
 */

// VIOLATION: code-quality/deterministic/regex-empty-repetition
export const regexEmptyRepetition = /(a*)+/;

// VIOLATION: code-quality/deterministic/regex-single-char-alternation
export const regexSingleCharAlternation = /(a|b|c)/;

// VIOLATION: code-quality/deterministic/regex-duplicate-char-class
export const regexDuplicateCharClass = /[aab]/;

// VIOLATION: code-quality/deterministic/regex-anchor-precedence
export const regexAnchorPrecedence = /^a|b$/;

// VIOLATION: code-quality/deterministic/regex-empty-alternative
export const regexEmptyAlternative = /a|/;

// VIOLATION: code-quality/deterministic/prefer-regex-exec
export function preferRegexExec(str: string) {
  return str.match(/test/);
}

// VIOLATION: code-quality/deterministic/unnecessary-regex-constructor
export function unnecessaryRegexConstructor() {
  return new RegExp('simple');
}

// VIOLATION: code-quality/deterministic/unnamed-regex-capture
export const unnamedRegexCapture = /(\d{4})-(\d{2})-(\d{2})/;

// VIOLATION: code-quality/deterministic/regex-unicode-awareness
export const regexUnicodeAwareness = /\p{Letter}/;
