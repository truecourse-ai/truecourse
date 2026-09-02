/**
 * Containment checks for relative paths that came from STORED DATA rather than
 * from the local filesystem — a content manifest's keys, a setup bundle's file
 * names. Such a path is attacker-influenceable (a filename can arrive through a
 * PR), so both the write-out side (`safeJoin`) and the store side
 * (`assertSafeRel`) reject anything that could escape its root. On a
 * multi-tenant host this is the arbitrary-file-write surface.
 */

import path from 'node:path';

/**
 * Reject a relative path that could escape its root: empty, null byte, absolute,
 * a Windows drive/UNC, or any `.`/`..` segment (after normalizing `\` → `/`, so
 * a literal `a\b` that becomes a separator on another OS is also caught).
 */
export function assertSafeRel(rel: string): void {
  if (!rel || rel.includes('\0')) {
    throw new Error(`[safe-path] unsafe relative path: ${JSON.stringify(rel)}`);
  }
  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) {
    throw new Error(`[safe-path] absolute path rejected: ${JSON.stringify(rel)}`);
  }
  for (const seg of norm.split('/')) {
    if (seg === '..' || seg === '.' || seg === '') {
      throw new Error(`[safe-path] unsafe path segment in: ${JSON.stringify(rel)}`);
    }
  }
}

/** Resolve `rel` under `root`, asserting it stays contained. */
export function safeJoin(root: string, rel: string): string {
  assertSafeRel(rel);
  const base = path.resolve(root);
  const dest = path.resolve(base, rel.replace(/\\/g, '/'));
  if (dest !== base && !dest.startsWith(base + path.sep)) {
    throw new Error(`[safe-path] path escapes root: ${JSON.stringify(rel)}`);
  }
  return dest;
}
