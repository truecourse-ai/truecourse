/**
 * An OPT-IN scope for document discovery, the inverse of `.truecourseignore`: a
 * list of gitignore-style globs, of which a path must match at least one to
 * enter the universe. An empty list is INACTIVE — discovery looks at
 * everything. A repository context source's include list is built from here.
 *
 * `.truecourseignore` is ALWAYS applied on top — the ignore file SUBTRACTS after
 * the include selects, so an include glob can never resurrect an ignored path.
 * (Discovery enforces that ordering; this module only answers "is this path in
 * the include scope?".)
 *
 * The glob engine is the same `ignore` package `.truecourseignore` uses, so both
 * scopes share one consistent gitignore-glob semantics. Build the matcher once
 * and reuse it across the whole walk.
 */

import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export interface SpecScope {
  /**
   * True when an include-scope is configured (at least one non-empty glob).
   * False → discovery looks at everything and `includes()` is always true.
   */
  active: boolean;
  /** The configured globs, cleaned. Empty when inactive. */
  globs: string[];
  /**
   * True when repo-relative `relPath` is within the scope. Always true when
   * inactive (no scope configured).
   */
  includes(relPath: string): boolean;
}

/** Coerce an untrusted include-glob list into a clean one (drop non-strings / blanks). */
function normalizeGlobs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
    .map((g) => g.trim());
}

/**
 * Build a scope matcher from a list of include globs. An empty/absent list (or
 * one that is all blanks) yields an INACTIVE scope — everything is in scope,
 * exactly as if the source configured no include globs.
 */
export function buildSpecScope(globs: unknown): SpecScope {
  const clean = normalizeGlobs(globs);
  if (clean.length === 0) {
    return { active: false, globs: [], includes: () => true };
  }
  const ig: Ignore = ignore().add(clean);
  return {
    active: true,
    globs: clean,
    includes(relPath: string): boolean {
      const rel = relPath.split(path.sep).join('/');
      // Empty (the root itself) or escaping the root → out of scope.
      if (rel === '' || rel.startsWith('..')) return false;
      return ig.ignores(rel);
    },
  };
}
