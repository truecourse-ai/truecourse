/**
 * Negative fixture for code-quality/deterministic/deprecated-api-usage.
 *
 * Rule should still fire when a deprecated symbol is consumed outside its
 * declaration site — i.e. a real caller invoking the deprecated function.
 *
 * File is named to avoid the substring `api`, which would otherwise flip the
 * containing service from `library` to `api-server` in the negative fixture's
 * graph snapshot.
 */

/**
 * @deprecated Use `parseDocumentId` instead — handles versioned ids correctly.
 */
function parseLegacyId(raw: string): string {
  return raw.trim();
}

export function resolveDocument(raw: string): string {
  // VIOLATION: code-quality/deterministic/deprecated-api-usage
  return parseLegacyId(raw);
}
