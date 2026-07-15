/**
 * `spec.include` / `spec.exclude` — the two per-repo scope knobs for spec-doc
 * discovery, configured in `.truecourse/config.json` under `spec` (arrays of
 * gitignore-style globs).
 *
 * `spec.include` is an OPT-IN scope, the inverse of `.truecourseignore`: when
 * present and non-empty, only markdown matching at least one glob enters the scan
 * universe; when absent or empty, discovery looks at everything (the default).
 *
 * `spec.exclude` is its symmetric subtraction: a subtree glob list that DROPS
 * matching markdown from the universe. Discovery applies it after include-scope
 * (and `.truecourseignore`), before relevance — so it removes docs the scope
 * selected, never resurrects ignored ones.
 *
 * `.truecourseignore` is ALWAYS applied on top of the include select — the ignore
 * file SUBTRACTS after the include selects, so an include glob can never resurrect
 * an ignored path. (Discovery enforces that ordering; this module only answers "is
 * this path in the include scope / dropped by the exclude?".)
 *
 * The glob engine is the same `ignore` package `.truecourseignore` uses, so every
 * scope shares one consistent gitignore-glob semantics. Read the config once
 * (`loadSpecScope` / `loadSpecExclude`) and reuse the matcher across the whole walk.
 */

import fs from 'node:fs';
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

/** Coerce an untrusted `spec.include` value into a clean glob list (drop non-strings / blanks). */
function normalizeGlobs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
    .map((g) => g.trim());
}

/**
 * Build a scope matcher from a list of include globs. An empty/absent list (or
 * one that is all blanks) yields an INACTIVE scope — everything is in scope,
 * exactly as if no `spec.include` were configured.
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

/**
 * Read `spec.include` from `<rootDir>/.truecourse/config.json` and build the
 * scope. A missing / unreadable / malformed config, or one without a non-empty
 * `spec.include`, yields an inactive scope (discovery looks at everything).
 */
export function loadSpecScope(rootDir: string): SpecScope {
  try {
    const file = path.join(rootDir, '.truecourse', 'config.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { spec?: { include?: unknown } };
    return buildSpecScope(parsed?.spec?.include);
  } catch {
    return buildSpecScope(undefined);
  }
}

export interface SpecExclude {
  /**
   * True when an exclude list is configured (at least one non-empty glob).
   * False → the exclude drops nothing and `excludes()` is always false.
   */
  active: boolean;
  /** The configured globs, cleaned. Empty when inactive. */
  globs: string[];
  /**
   * True when repo-relative `relPath` is dropped by the exclude. Always false
   * when inactive (no exclude configured).
   */
  excludes(relPath: string): boolean;
}

/**
 * Build an exclude matcher from a list of subtree globs. An empty/absent list (or
 * one that is all blanks) yields an INACTIVE exclude — nothing is dropped, exactly
 * as if no `spec.exclude` were configured.
 */
export function buildSpecExclude(globs: unknown): SpecExclude {
  const clean = normalizeGlobs(globs);
  if (clean.length === 0) {
    return { active: false, globs: [], excludes: () => false };
  }
  const ig: Ignore = ignore().add(clean);
  return {
    active: true,
    globs: clean,
    excludes(relPath: string): boolean {
      const rel = relPath.split(path.sep).join('/');
      // Empty (the root itself) or escaping the root → never dropped.
      if (rel === '' || rel.startsWith('..')) return false;
      return ig.ignores(rel);
    },
  };
}

/**
 * Read `spec.exclude` from `<rootDir>/.truecourse/config.json` and build the
 * exclude. A missing / unreadable / malformed config, or one without a non-empty
 * `spec.exclude`, yields an inactive exclude (nothing is dropped).
 */
export function loadSpecExclude(rootDir: string): SpecExclude {
  try {
    const file = path.join(rootDir, '.truecourse', 'config.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { spec?: { exclude?: unknown } };
    return buildSpecExclude(parsed?.spec?.exclude);
  } catch {
    return buildSpecExclude(undefined);
  }
}
