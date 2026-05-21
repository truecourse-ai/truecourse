// Paraphrased FP shapes for code-quality/deterministic/regex-duplicate-char-class.

// 1. Four-digit \uXXXX Unicode-escape range. The hex digits inside the two
//    escapes (\u0300 and \u036f) define the combining-diacritical-marks
//    range — they are NOT duplicate literal characters in the class.
export function stripCombiningMarks(input: string): string {
  return input.replace(/[\u0300-\u036f]/gu, '');
}

// 2. Braced \u{XXXX} Unicode-escape range inside a character class with the
// `u` flag. Each \u{...} escape denotes a single Unicode code point; the
// parser must not treat the hex digits or braces as separate characters.
export const allowedExtendedCharRange = /^[a-z\u{0080}-\u{FFFF}]+$/u;

// 3. \xXX hex byte escape inside a character class. \x7F is a single byte;
// its hex digits are part of the escape, not duplicate literal characters.
export const printableAsciiPattern = /^[\x20-\x7F]+$/u;
