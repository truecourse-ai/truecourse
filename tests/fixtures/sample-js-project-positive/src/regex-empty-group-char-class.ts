/**
 * Positive fixture for code-quality/deterministic/regex-empty-group.
 *
 * `()` appearing inside a character class `[...]` is literal `(` and `)` — it
 * does NOT create an empty capture group. The visitor must scan the regex
 * source while tracking whether the cursor is inside a character class.
 *
 * Built dynamically via `new RegExp` so unrelated regex-literal rules
 * (unnamed-regex-capture, require-unicode-regexp) are not engaged.
 */

function makeCharClassMatcher(extra: string): RegExp {
  return new RegExp(`[!@#$%^&*()${extra}]`, 'u');
}

const specialChars = makeCharClassMatcher('_+=-');
const punctuationOrParen = makeCharClassMatcher('.,;:?');

export function hasSpecial(value: string): boolean {
  return specialChars.test(value);
}

export function hasPunctuation(value: string): boolean {
  return punctuationOrParen.test(value);
}
