/**
 * Helper module for relative namespace import test.
 */

export function capitalize(str: string): string {
  if (str.length === 0) return str;
  const first = str[0] ?? '';
  return first.toUpperCase() + str.slice(1);
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-/gu, '')
    .replace(/-$/gu, '');
}
