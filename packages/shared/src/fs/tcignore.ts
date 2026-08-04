/**
 * `.truecourseignore` — a single, shared ignore mechanism for every
 * directory walk TrueCourse performs: code-file analysis, the spec
 * doc-scan (consolidator), and the verifier's code-side extractors.
 *
 * The file uses gitignore syntax (parsed by the `ignore` package) and
 * lives at the repo root. Patterns are always anchored at that root, so
 * the same `reference/` line excludes those paths whether the caller is
 * walking the repo root (doc-scan) or a subdirectory like `code/` (the
 * verifier). Callers that already know the repo root can pass it; those
 * that start from a subdirectory let `loadTcIgnore` walk up to find it.
 *
 * Scope boundary: an ignore file governs only the subtree it claims. When
 * the file found by the upward walk ignores the scan's own start
 * directory, it has declared that subtree to be outside its universe, so
 * it does not filter a scan rooted there — that scan gets an empty
 * matcher anchored at its own start directory.
 *
 * This is what keeps an outer repo's rules from erasing a self-contained
 * project nested under a path the outer repo excludes: a fixture repo
 * under `tests/fixtures/`, a vendored checkout under `third_party/`. Such
 * a nested project need not carry any marker of its own — the outer
 * file's own patterns are the signal. A subdirectory of the *same* repo
 * (`code/`, which its repo does not ignore) is unaffected and keeps
 * inheriting the root's rules.
 */

import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

/** Markers that identify a repo root, in priority order. */
const ROOT_MARKERS = ['.truecourseignore', '.truecourse', '.git'];

export interface TcIgnore {
  /** The directory the `.truecourseignore` was anchored at. */
  root: string;
  /** True when `absPath` (a file or directory) is excluded. */
  ignores(absPath: string): boolean;
  /**
   * True when `absPath` is *explicitly re-included* by a negation rule
   * (a `!pattern` line) — as opposed to merely not matching any rule.
   *
   * This is the signal that distinguishes "the scope deliberately opted
   * into this path" from "no opinion". Directory walkers use it to let an
   * explicit re-include override a hardcoded skip list: an allow-list
   * ignore (`*.md` + `!docs/.../build/**`) re-includes the `.md` files
   * inside a `build/` tree, so a probe of a markdown descendant reports
   * `true` here even though the bare directory matches no rule.
   */
  reincludes(absPath: string): boolean;
}

/**
 * Walk up from `startDir` to the nearest directory containing a repo
 * marker (`.truecourseignore`, `.truecourse`, or `.git`). Falls back to
 * `startDir` when none is found — in that case there's no ignore file to
 * read anyway, so the anchor is immaterial.
 */
export function findRepoRoot(startDir: string): string {
  const start = path.resolve(startDir);
  let dir = start;
  for (;;) {
    if (ROOT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** Root-relative, forward-slashed path; `''` for the root itself. */
function relFromRoot(root: string, absPath: string): string {
  return path.relative(root, path.resolve(absPath)).split(path.sep).join('/');
}

/**
 * True when `absDir` is excluded *as a directory*. Probed with a trailing
 * slash because a directory-only rule (`tests/fixtures/`) matches the bare
 * name `tests/fixtures` only in directory form, while a file rule
 * (`*.gen.ts`) matches no directory either way.
 */
function ignoresDirectory(ig: Ignore, root: string, absDir: string): boolean {
  const rel = relFromRoot(root, absDir);
  // The root itself, or a path escaping it, is never out of its own scope.
  if (rel === '' || rel.startsWith('..')) return false;
  return ig.ignores(`${rel}/`);
}

function makeTcIgnore(root: string, ig: Ignore): TcIgnore {
  return {
    root,
    ignores(absPath: string): boolean {
      const rel = relFromRoot(root, absPath);
      // Empty (the root itself) or escaping the root → out of scope.
      if (rel === '' || rel.startsWith('..')) return false;
      return ig.ignores(rel);
    },
    reincludes(absPath: string): boolean {
      const rel = relFromRoot(root, absPath);
      if (rel === '' || rel.startsWith('..')) return false;
      return ig.test(rel).unignored;
    },
  };
}

/**
 * Build a `.truecourseignore` matcher for a scan rooted at `startDir`,
 * anchored at the repo root found by walking up. When no
 * `.truecourseignore` exists, or the one found excludes `startDir`
 * itself, the matcher ignores nothing. Paths outside the anchor are never
 * ignored.
 */
export function loadTcIgnore(startDir: string): TcIgnore {
  const start = path.resolve(startDir);
  const root = findRepoRoot(start);
  const ig: Ignore = ignore();
  try {
    ig.add(fs.readFileSync(path.join(root, '.truecourseignore'), 'utf8'));
  } catch {
    // No file (or unreadable) → empty matcher; nothing is ignored.
  }
  // The file found upward excludes this scan's root, so it speaks for a
  // different scope. Filtering by it would erase the whole scan.
  if (ignoresDirectory(ig, root, start)) return makeTcIgnore(start, ignore());
  return makeTcIgnore(root, ig);
}
