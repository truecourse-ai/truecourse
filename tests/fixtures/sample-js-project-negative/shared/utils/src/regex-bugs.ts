/**
 * Regex-related bugs — various regex anti-patterns.
 */

export const controlChars = /[\x00-\x1f]/;

// VIOLATION: bugs/deterministic/empty-character-class
export const emptyCharClass = /[]/;

// VIOLATION: bugs/deterministic/regex-group-reference-mismatch
export function groupMismatch(input: string) {
  return input.replace(/(a)(b)/, '$3');
}

// VIOLATION: bugs/deterministic/useless-backreference
export const backreference = /\1(abc)/;

// VIOLATION: bugs/deterministic/invalid-regexp
export function badRegex() {
  try {
    return new RegExp('[');
  } catch {
    return null;
  }
}

// VIOLATION: bugs/deterministic/ambiguous-div-regex
export function divOrRegex() {
  return /=test/g;
}

// VIOLATION: code-quality/deterministic/regex-anchor-precedence
export const anchorPrecedence = /^a|b$/;

// VIOLATION: code-quality/deterministic/regex-duplicate-char-class
export const dupCharClass = /[aa]/;

// VIOLATION: code-quality/deterministic/regex-empty-alternative
export const emptyAlternative = /|a/;

// VIOLATION: code-quality/deterministic/regex-empty-repetition
export const emptyRepetition = /(?:)*/;

// VIOLATION: code-quality/deterministic/regex-single-char-alternation
export const singleCharAlt = /(a|b|c)/;

// VIOLATION: bugs/deterministic/misleading-character-class
export const misleadingRange = /[😀-😂]/;

// VIOLATION: bugs/deterministic/redos-vulnerable-regex
export const redos = /^(a+)+$/;
