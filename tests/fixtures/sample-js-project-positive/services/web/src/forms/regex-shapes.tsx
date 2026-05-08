/**
 * regex-empty-group + regex-duplicate-char-class shapes that
 * should NOT fire:
 *
 * - Character class containing `()` as literal characters
 *   (`/[(){}]/`) is not an empty group.
 * - Single Unicode range `[̀-ͯ]` is not a duplicate
 *   character class.
 */

export function hasSpecialChar(s: string): boolean {
  return /[`~<>?,./!@#$%^&*()\-_"'+=|{}[\];:\\]/u.test(s);
}

export function stripCombiningMarks(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/gu, "");
}
