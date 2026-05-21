/**
 * A genuine duplicate-string bug pattern: the same multi-word error
 * message is repeated across several validators in the same file.
 * Extracting it to a named constant would deduplicate the message and
 * keep wording consistent across call sites.
 */

// VIOLATION: code-quality/deterministic/duplicate-string
export function ensureTokenPresent(token: string | undefined): string {
  if (!token) throw new Error('Authentication token is required for this operation');
  return token;
}

export function ensureTokenLength(token: string): string {
  if (token.length < 8) throw new Error('Authentication token is required for this operation');
  return token;
}

export function ensureTokenShape(token: string): string {
  if (!/^[a-z0-9]+$/i.test(token)) {
    throw new Error('Authentication token is required for this operation');
  }
  return token;
}
